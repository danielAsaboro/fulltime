import {
  ANSWER_ATTESTATION_PROTOCOL,
  ANSWER_ATTESTATION_VERSION,
  decodeSignedAnswerSubmission,
  encodeAnswerAttestationResponse,
  type AnswerAttestationResponse,
  type SignedAnswerSubmission,
} from "../../../packages/shared/src/answer-attestation.js";

import { AttestorError, attestorError } from "./errors.js";
import { FixtureCallFeed } from "./fixture-call-feed.js";
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
  type HyperswarmLike,
  type ProtomuxChannelLike,
  type ProtomuxLike,
} from "./holepunch.js";
import { verifyMemberSubmission } from "./identity.js";
import { ReceiptLog } from "./receipt-log.js";

const HEX_KEY = /^[a-f0-9]{64}$/;
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;
const MAX_IN_FLIGHT_PER_CONNECTION = 32;

export interface AnswerAttestorOptions {
  storageDir: string;
  fixtureFeedKey: string;
  expectedServicePublicKey?: string;
  expectedReceiptFeedKey?: string;
  bootstrap?: BootstrapNode[];
  maxPeers?: number;
  /** Authoritative receive clock; archive import binds this to replay feed time. */
  clock?: () => number;
}

export interface AnswerAttestorDescriptor {
  protocol: typeof ANSWER_ATTESTATION_PROTOCOL;
  version: typeof ANSWER_ATTESTATION_VERSION;
  servicePublicKey: string;
  receiptFeedKey: string;
  fixtureFeedKey: string;
  receiptLength: number;
}

interface ConnectionState {
  connection: ConnectionLike;
  mux: ProtomuxLike;
  channel: ProtomuxChannelLike | null;
  inFlight: number;
}

export class AnswerAttestorService {
  readonly options: AnswerAttestorOptions;

  private store: CorestoreLike | null = null;
  private swarm: HyperswarmLike | null = null;
  private fixtureDiscovery: DiscoveryLike | null = null;
  private serviceDiscovery: DiscoveryLike | null = null;
  private fixtureFeed: FixtureCallFeed | null = null;
  private receiptLog: ReceiptLog | null = null;
  private readonly connections = new Map<ConnectionLike, ConnectionState>();
  private handleTail: Promise<void> = Promise.resolve();
  private readonly clock: () => number;
  private opened = false;
  private closed = false;

  constructor(options: AnswerAttestorOptions) {
    if (!options.storageDir) throw new TypeError("Attestor storage directory is required");
    if (!HEX_KEY.test(options.fixtureFeedKey)) throw new TypeError("Fixture feed key must be 32-byte lowercase hex");
    if (options.expectedServicePublicKey && !HEX_KEY.test(options.expectedServicePublicKey)) {
      throw new TypeError("Expected service public key must be 32-byte lowercase hex");
    }
    if (options.expectedReceiptFeedKey && !HEX_KEY.test(options.expectedReceiptFeedKey)) {
      throw new TypeError("Expected receipt feed key must be 32-byte lowercase hex");
    }
    if (options.clock !== undefined && typeof options.clock !== "function") throw new TypeError("Answer attestor clock must be a function");
    this.options = { ...options };
    this.clock = options.clock ?? Date.now;
  }

  get descriptor(): AnswerAttestorDescriptor {
    this.assertOpen();
    return {
      protocol: ANSWER_ATTESTATION_PROTOCOL,
      version: ANSWER_ATTESTATION_VERSION,
      servicePublicKey: this.receiptLog!.servicePublicKey,
      receiptFeedKey: this.receiptLog!.receiptFeedKey,
      fixtureFeedKey: this.options.fixtureFeedKey,
      receiptLength: this.receiptLog!.core.length,
    };
  }

  async open(): Promise<this> {
    if (this.opened) return this;
    if (this.closed) throw new Error("Answer attestor is closed");
    const store = new Corestore(this.options.storageDir);
    await store.ready();
    try {
      const receiptCore = store.get({ name: ReceiptLog.coreName(), active: true });
      const receiptLog = new ReceiptLog(receiptCore);
      await receiptLog.open(this.options.expectedServicePublicKey);
      if (this.options.expectedReceiptFeedKey && receiptLog.receiptFeedKey !== this.options.expectedReceiptFeedKey) {
        throw new Error(`Persistent receipt feed is ${receiptLog.receiptFeedKey}, expected ${this.options.expectedReceiptFeedKey}`);
      }

      const fixtureCore = store.get({ key: b4a.from(this.options.fixtureFeedKey, "hex"), active: true });
      const fixtureFeed = new FixtureCallFeed(fixtureCore, this.options.fixtureFeedKey);
      await fixtureFeed.open();

      const swarm = new Hyperswarm({ bootstrap: this.options.bootstrap, maxPeers: this.options.maxPeers ?? 64 });
      swarm.on("connection", (connection) => this.onConnection(connection));
      swarm.on("error", (error) => process.stderr.write(`[answer-attestor] swarm error: ${error.message}\n`));
      this.store = store;
      this.receiptLog = receiptLog;
      this.fixtureFeed = fixtureFeed;
      this.swarm = swarm;
      this.fixtureDiscovery = swarm.join(fixtureCore.discoveryKey, { server: false, client: true });
      this.serviceDiscovery = swarm.join(receiptCore.discoveryKey, { server: true, client: false });
      await Promise.all([this.fixtureDiscovery.flushed(), this.serviceDiscovery.flushed()]);
      this.opened = true;
      return this;
    } catch (error) {
      await store.close().catch(() => undefined);
      throw error;
    }
  }

  /** Direct boundary used by the Protomux handler and deterministic unit callers. */
  attest(value: unknown): Promise<AnswerAttestationResponse> {
    return this.attestReceived(value, Date.now());
  }

  private attestReceived(value: unknown, serviceReceivedAt: number): Promise<AnswerAttestationResponse> {
    let submission: SignedAnswerSubmission;
    try {
      submission = verifyMemberSubmission(value);
    } catch (error) {
      const requestId = safeRequestId(value);
      return Promise.resolve(errorResponse(requestId, attestorError(error)));
    }
    const operation = this.handleTail.then(async () => this.attestSerial(submission, serviceReceivedAt));
    this.handleTail = operation.then(() => undefined, () => undefined);
    return operation.catch((error: unknown) => errorResponse(submission.requestId, attestorError(error)));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.opened = false;
    await this.handleTail.catch(() => undefined);
    for (const state of this.connections.values()) {
      state.mux.unpair(this.channelDescriptor());
      state.channel?.close();
    }
    this.connections.clear();
    await this.fixtureDiscovery?.destroy().catch(() => undefined);
    await this.serviceDiscovery?.destroy().catch(() => undefined);
    await this.swarm?.destroy().catch(() => undefined);
    await this.store?.close().catch(() => undefined);
    this.fixtureDiscovery = null;
    this.serviceDiscovery = null;
    this.swarm = null;
    this.store = null;
    this.fixtureFeed = null;
    this.receiptLog = null;
  }

  private async attestSerial(submission: SignedAnswerSubmission, serviceReceivedAt: number): Promise<AnswerAttestationResponse> {
    this.assertOpen();
    if (!Number.isSafeInteger(serviceReceivedAt) || serviceReceivedAt < 0) {
      throw new AttestorError("INVALID_RECEIVE_TIME", "Service receive time is invalid");
    }
    if (submission.submittedAt > serviceReceivedAt + MAX_CLOCK_AHEAD_MS) {
      throw new AttestorError("INVALID_SUBMISSION_TIME", "Answer submission time is too far ahead of service time");
    }
    this.receiptLog!.assertFresh(submission);
    await this.fixtureFeed!.refresh(true);
    const indexed = this.fixtureFeed!.requireOpenCall(submission.callId);
    const call = indexed.call;
    if (!call.options.some((option) => option.id === submission.optionId)) {
      throw new AttestorError("INVALID_OPTION", `Option ${submission.optionId} does not belong to call ${call.id}`);
    }
    const deadlineAt = call.locksAt;
    if (serviceReceivedAt > deadlineAt) {
      throw new AttestorError("ANSWER_LATE", "Answer reached the attestor after the call lock time");
    }
    const head = await this.fixtureFeed!.head();
    const token = await this.receiptLog!.append(submission, {
      serviceReceivedAt,
      deadlineAt,
      fixtureFeedKey: head.key,
      fixtureFeedFork: head.fork,
      fixtureFeedLength: head.length,
      fixtureFeedTreeHash: head.treeHash,
      callFeedIndex: indexed.feedIndex,
      fixtureId: call.fixtureId,
      locksAt: call.locksAt,
    });
    return {
      version: ANSWER_ATTESTATION_VERSION,
      requestId: submission.requestId,
      ok: true,
      token,
    };
  }

  private onConnection(connection: ConnectionLike): void {
    if (this.closed || !this.store || !this.receiptLog || this.connections.has(connection)) return;
    this.store.replicate(connection);
    const state: ConnectionState = { connection, mux: Protomux.from(connection), channel: null, inFlight: 0 };
    this.connections.set(connection, state);
    state.mux.pair(this.channelDescriptor(), () => this.openIncomingChannel(state));
    connection.once("close", () => this.removeConnection(connection));
  }

  private openIncomingChannel(state: ConnectionState): void {
    if (state.channel || this.closed) return;
    const channel = state.mux.createChannel({
      ...this.channelDescriptor(),
      onclose: () => { state.channel = null; },
    });
    if (!channel) return;
    const requestMessage = channel.addMessage({
      encoding: compactEncoding.buffer,
      onmessage: (bytes) => {
        const receivedAt = this.clock();
        let value: SignedAnswerSubmission;
        try {
          value = decodeSignedAnswerSubmission(bytes);
        } catch (error) {
          responseMessage.send(encodeAnswerAttestationResponse(errorResponse(null, attestorError(error))));
          return;
        }
        if (state.inFlight >= MAX_IN_FLIGHT_PER_CONNECTION) {
          responseMessage.send(encodeAnswerAttestationResponse(errorResponse(
            value.requestId,
            new AttestorError("SERVICE_BUSY", "Too many answer requests are already in flight", true),
          )));
          return;
        }
        state.inFlight += 1;
        void this.attestReceived(value, receivedAt)
          .then((response) => {
            if (!channel.closed) responseMessage.send(encodeAnswerAttestationResponse(response));
          })
          .catch(() => undefined)
          .finally(() => { state.inFlight -= 1; });
      },
    });
    void requestMessage;
    const responseMessage = channel.addMessage({ encoding: compactEncoding.buffer });
    state.channel = channel;
    channel.open();
  }

  private removeConnection(connection: ConnectionLike): void {
    const state = this.connections.get(connection);
    if (!state) return;
    state.mux.unpair(this.channelDescriptor());
    state.channel?.close();
    this.connections.delete(connection);
  }

  private channelDescriptor(): { protocol: string; id: Uint8Array } {
    if (!this.receiptLog) throw new Error("Answer attestor identity is unavailable");
    return {
      protocol: ANSWER_ATTESTATION_PROTOCOL,
      id: b4a.from(this.receiptLog.servicePublicKey, "hex"),
    };
  }

  private assertOpen(): void {
    if (!this.opened || this.closed || !this.receiptLog || !this.fixtureFeed) {
      throw new Error("Answer attestor is not open");
    }
  }
}

function errorResponse(requestId: string | null, error: AttestorError): AnswerAttestationResponse {
  return {
    version: ANSWER_ATTESTATION_VERSION,
    requestId,
    ok: false,
    error: {
      code: error.code,
      message: error.message.slice(0, 1_024) || "Answer attestation failed",
      recoverable: error.recoverable,
    },
  };
}

function safeRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" && /^[\p{L}\p{N}][\p{L}\p{N}._:/-]{7,127}$/u.test(requestId)
    ? requestId
    : null;
}
