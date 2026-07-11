import b4a from "b4a";
import FramedStream from "framed-stream";
import { Worklet } from "react-native-bare-kit";

import roomWorkerBundle from "../generated/room-worker.bundle.mjs";
import type { SignedNetworkManifest } from "./network-manifest";

const PROTOCOL_VERSION = 2;
const MAX_REQUESTS = 128;
const REQUEST_TIMEOUT_MS = 60_000;

export type PeerEvent = Record<string, unknown> & { version: 2; type: string };

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class MobilePeerError extends Error {
  code: string;
  recoverable: boolean;

  constructor(code: string, message: string, recoverable = true) {
    super(message);
    this.name = "MobilePeerError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export class MobilePeerController {
  private worklet: Worklet | null = null;
  private pipe: FramedStream | null = null;
  private sequence = 0;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<(event: PeerEvent) => void>();
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;

  async start(options: {
    storagePath: string;
    displayName: string;
    deviceSecret: Uint8Array;
    manifest: SignedNetworkManifest;
  }): Promise<void> {
    if (this.worklet) throw new Error("Mobile peer worker is already started");
    if (options.deviceSecret.byteLength !== 32) throw new TypeError("Mobile peer device secret must be 32 bytes");

    const args = [
      "--storage", options.storagePath,
      "--name", options.displayName,
      "--fixture-feed-key", options.manifest.fixtureFeedKey,
      "--disable-notifications",
    ];
    if (options.manifest.answerAttestor) {
      args.push(
        "--answer-attestor-public-key", options.manifest.answerAttestor.servicePublicKey,
        "--answer-receipt-feed-key", options.manifest.answerAttestor.receiptFeedKey,
      );
    }

    const worklet = new Worklet("fulltime-room-peer", { memoryLimit: 256 * 1024 * 1024 });
    const pipe = new FramedStream(worklet.IPC, { bits: 24 });
    this.worklet = worklet;
    this.pipe = pipe;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    pipe.on("data", (data: unknown) => this.onFrame(data as Uint8Array));
    pipe.on("error", (error: Error) => this.fail(new MobilePeerError("WORKER_UNAVAILABLE", error.message, false)));
    pipe.on("close", () => this.fail(new MobilePeerError("WORKER_UNAVAILABLE", "The mobile peer worker closed", false)));

    worklet.start("/fulltime-rooms.bundle", roomWorkerBundle, args);
    pipe.write(b4a.from(JSON.stringify({
      version: 1,
      type: "fulltime.rooms.bootstrap",
      deviceSecret: b4a.toString(options.deviceSecret, "hex"),
    }), "utf8"));
    options.deviceSecret.fill(0);

    const timer = setTimeout(() => this.rejectReady?.(new MobilePeerError("WORKER_STARTUP_TIMEOUT", "The mobile peer worker did not become ready", false)), 60_000);
    try {
      await this.readyPromise;
    } finally {
      clearTimeout(timer);
    }
  }

  subscribe(listener: (event: PeerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request<T = unknown>(action: string, payload: unknown = null): Promise<T> {
    if (!this.pipe || !this.readyPromise) throw new MobilePeerError("WORKER_UNAVAILABLE", "The mobile peer worker is unavailable", false);
    await this.readyPromise;
    if (this.pending.size >= MAX_REQUESTS) throw new MobilePeerError("TOO_MANY_REQUESTS", "Too many peer requests are active");
    const id = `mobile:${Date.now().toString(36)}:${(++this.sequence).toString(36)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MobilePeerError("REQUEST_TIMEOUT", `Peer request ${action} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.pipe?.write(b4a.from(JSON.stringify({ version: PROTOCOL_VERSION, id, action, payload }), "utf8"));
    });
  }

  async close(): Promise<void> {
    if (!this.worklet) return;
    try {
      await this.request("system.close", null).catch(() => undefined);
    } finally {
      this.worklet.terminate();
      this.pipe?.destroy();
      this.worklet = null;
      this.pipe = null;
      this.fail(new MobilePeerError("WORKER_UNAVAILABLE", "The mobile peer worker stopped", false));
    }
  }

  private onFrame(data: Uint8Array): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(b4a.toString(data, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid frame");
      frame = parsed as Record<string, unknown>;
    } catch {
      this.fail(new MobilePeerError("COMMAND_PROTOCOL", "The peer worker sent an invalid frame", false));
      return;
    }
    if (frame.version !== PROTOCOL_VERSION) {
      this.fail(new MobilePeerError("COMMAND_PROTOCOL", "The peer worker protocol version is unsupported", false));
      return;
    }
    if (typeof frame.type === "string") {
      const event = frame as PeerEvent;
      if (event.type === "bridge.ready") {
        this.resolveReady?.();
        this.resolveReady = null;
        this.rejectReady = null;
      }
      for (const listener of this.listeners) listener(event);
      return;
    }
    if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") return;
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok) pending.resolve(frame.result);
    else {
      const error = frame.error as Record<string, unknown> | undefined;
      pending.reject(new MobilePeerError(
        typeof error?.code === "string" ? error.code : "ROOM_REQUEST_FAILED",
        typeof error?.message === "string" ? error.message : "Room request failed",
        error?.recoverable !== false,
      ));
    }
  }

  private fail(error: Error): void {
    this.rejectReady?.(error);
    this.rejectReady = null;
    this.resolveReady = null;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}
