import {
  ANSWER_ATTESTATION_PROTOCOL,
  decodeAnswerAcceptedReceiptRecord,
  decodeAnswerAttestationResponse,
  encodeSignedAnswerSubmission,
  parseSignedAnswerSubmission,
  type AnswerAcceptanceToken,
  type AnswerAttestationResponse,
  type SignedAnswerSubmission,
} from "../../../packages/shared/src/answer-attestation.js";

import {
  Corestore,
  Hyperswarm,
  Protomux,
  b4a,
  compactEncoding,
  type BootstrapNode,
  type ConnectionLike,
  type CorestoreLike,
  type DiscoveryLike,
  type HypercoreLike,
  type HyperswarmLike,
  type ProtomuxChannelLike,
  type ProtomuxMessageLike,
} from "./holepunch.js";
import { verifyAcceptanceToken } from "./identity.js";

const HEX_KEY = /^[a-f0-9]{64}$/;

export interface AnswerAttestorClientOptions {
  storageDir: string;
  servicePublicKey: string;
  receiptFeedKey: string;
  fixtureFeedKey: string;
  bootstrap?: BootstrapNode[];
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve(token: AnswerAcceptanceToken): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClientConnection {
  connection: ConnectionLike;
  channel: ProtomuxChannelLike;
  requestMessage: ProtomuxMessageLike;
}

export class AttestationRejectedError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable: boolean) {
    super(message);
    this.name = "AttestationRejectedError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class AnswerAttestorClient {
  readonly options: AnswerAttestorClientOptions;

  private store: CorestoreLike | null = null;
  private swarm: HyperswarmLike | null = null;
  private receiptCore: HypercoreLike | null = null;
  private discovery: DiscoveryLike | null = null;
  private readonly connections = new Map<ConnectionLike, ClientConnection>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly channelWaiters = new Set<() => void>();
  private opened = false;
  private closed = false;

  constructor(options: AnswerAttestorClientOptions) {
    if (!options.storageDir) throw new TypeError("Attestor client storage directory is required");
    if (!HEX_KEY.test(options.servicePublicKey)) throw new TypeError("Service public key must be 32-byte lowercase hex");
    if (!HEX_KEY.test(options.receiptFeedKey)) throw new TypeError("Receipt feed key must be 32-byte lowercase hex");
    if (!HEX_KEY.test(options.fixtureFeedKey)) throw new TypeError("Fixture feed key must be 32-byte lowercase hex");
    if (options.requestTimeoutMs !== undefined && (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs < 1)) {
      throw new TypeError("Request timeout must be a positive integer");
    }
    this.options = { ...options };
  }

  async open(): Promise<this> {
    if (this.opened) return this;
    if (this.closed) throw new Error("Answer attestor client is closed");
    const store = new Corestore(this.options.storageDir);
    await store.ready();
    try {
      const receiptCore = store.get({ key: b4a.from(this.options.receiptFeedKey, "hex"), active: true });
      await receiptCore.ready();
      if (b4a.toString(receiptCore.key, "hex") !== this.options.receiptFeedKey) {
        throw new Error("Corestore opened an unexpected answer receipt feed");
      }
      const swarm = new Hyperswarm({ bootstrap: this.options.bootstrap, maxPeers: 8 });
      this.store = store;
      this.receiptCore = receiptCore;
      this.swarm = swarm;
      this.opened = true;
      swarm.on("connection", (connection) => this.onConnection(connection));
      swarm.on("error", (error) => this.failAll(error));
      this.discovery = swarm.join(receiptCore.discoveryKey, { server: false, client: true });
      await this.discovery.flushed();
      return this;
    } catch (error) {
      this.opened = false;
      await store.close().catch(() => undefined);
      throw error;
    }
  }

  async submit(value: SignedAnswerSubmission): Promise<AnswerAcceptanceToken> {
    this.assertOpen();
    const submission = parseSignedAnswerSubmission(value);
    if (this.pending.has(submission.requestId)) throw new Error(`Request ${submission.requestId} is already in flight`);
    const connection = await this.waitForChannel();
    return new Promise<AnswerAcceptanceToken>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(submission.requestId);
        reject(new Error(`Answer attestation request ${submission.requestId} timed out`));
      }, this.options.requestTimeoutMs ?? 10_000);
      timer.unref?.();
      this.pending.set(submission.requestId, { resolve, reject, timer });
      try {
        connection.requestMessage.send(encodeSignedAnswerSubmission(submission));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(submission.requestId);
        reject(error instanceof Error ? error : new Error("Could not send answer attestation request"));
      }
    });
  }

  async readReceipt(index: number, timeout = 5_000): Promise<AnswerAcceptanceToken> {
    this.assertOpen();
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("Receipt index is invalid");
    const block = await this.receiptCore!.get(index, { wait: true, timeout });
    if (!block) throw new Error(`Answer receipt ${index} is unavailable`);
    const record = decodeAnswerAcceptedReceiptRecord(block);
    if (record.token.claims.receiptIndex !== index) throw new Error(`Answer receipt ${index} contains a different index`);
    const token = verifyAcceptanceToken(record.token, this.options.servicePublicKey, this.options.receiptFeedKey);
    if (token.claims.fixtureFeedKey !== this.options.fixtureFeedKey) {
      throw new Error("Answer receipt references an unexpected fixture feed");
    }
    return token;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.opened = false;
    this.failAll(new Error("Answer attestor client closed"));
    for (const state of this.connections.values()) state.channel.close();
    this.connections.clear();
    await this.discovery?.destroy().catch(() => undefined);
    await this.swarm?.destroy().catch(() => undefined);
    await this.store?.close().catch(() => undefined);
    this.discovery = null;
    this.swarm = null;
    this.receiptCore = null;
    this.store = null;
  }

  private onConnection(connection: ConnectionLike): void {
    if (!this.opened || !this.store || this.connections.has(connection)) return;
    this.store.replicate(connection);
    const mux = Protomux.from(connection);
    const channel = mux.createChannel({
      ...this.channelDescriptor(),
      onopen: () => {
        // Protomux invokes onopen immediately before flipping `opened`; defer
        // one microtask so waiters observe the fully-open channel.
        queueMicrotask(() => {
          for (const wake of this.channelWaiters) wake();
        });
      },
      onclose: () => this.removeConnection(connection),
    });
    if (!channel) return;
    const requestMessage = channel.addMessage({ encoding: compactEncoding.buffer });
    channel.addMessage({
      encoding: compactEncoding.buffer,
      onmessage: (bytes) => this.onResponse(bytes),
    });
    this.connections.set(connection, { connection, channel, requestMessage });
    connection.once("close", () => this.removeConnection(connection));
    channel.open();
  }

  private onResponse(bytes: Uint8Array): void {
    let response: AnswerAttestationResponse;
    try {
      response = decodeAnswerAttestationResponse(bytes);
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error("Attestor returned an invalid response"));
      return;
    }
    if (!response.ok && response.requestId === null) {
      this.failAll(new AttestationRejectedError(response.error.code, response.error.message, response.error.recoverable));
      return;
    }
    if (response.requestId === null) return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    if (!response.ok) {
      pending.reject(new AttestationRejectedError(response.error.code, response.error.message, response.error.recoverable));
      return;
    }
    try {
      const token = verifyAcceptanceToken(response.token, this.options.servicePublicKey, this.options.receiptFeedKey);
      if (token.claims.fixtureFeedKey !== this.options.fixtureFeedKey) {
        throw new Error("Acceptance token references an unexpected fixture feed");
      }
      if (token.claims.submission.requestId !== response.requestId) throw new Error("Acceptance token request ID mismatch");
      pending.resolve(token);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error("Acceptance token verification failed"));
    }
  }

  private async waitForChannel(): Promise<ClientConnection> {
    const ready = this.readyConnection();
    if (ready) return ready;
    return new Promise<ClientConnection>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const wake = (): void => {
        const connection = this.readyConnection();
        if (!connection) return;
        clearTimeout(timer);
        this.channelWaiters.delete(wake);
        resolve(connection);
      };
      timer = setTimeout(() => {
        this.channelWaiters.delete(wake);
        reject(new Error("Could not connect to the pinned answer-attestor service"));
      }, this.options.requestTimeoutMs ?? 10_000);
      timer.unref?.();
      this.channelWaiters.add(wake);
    });
  }

  private readyConnection(): ClientConnection | null {
    for (const state of this.connections.values()) {
      if (state.channel.opened && !state.channel.closed) return state;
    }
    return null;
  }

  private removeConnection(connection: ConnectionLike): void {
    const state = this.connections.get(connection);
    if (!state) return;
    this.connections.delete(connection);
    if (!state.channel.closed) state.channel.close();
  }

  private channelDescriptor(): { protocol: string; id: Uint8Array } {
    return {
      protocol: ANSWER_ATTESTATION_PROTOCOL,
      id: b4a.from(this.options.servicePublicKey, "hex"),
    };
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private assertOpen(): void {
    if (!this.opened || this.closed || !this.store || !this.swarm || !this.receiptCore) {
      throw new Error("Answer attestor client is not open");
    }
  }
}
