/**
 * Generic SSE consumer for the TxLINE streams.
 *
 * Robustness the feed demands: exponential-backoff reconnect, `Last-Event-ID`
 * resume, heartbeat-gap detection (no bytes within a window ⇒ reconnect + `onGap`
 * so open calls crossing the gap can void), and event-id dedupe across reconnects.
 */

import type { Logger } from "../logger.js";
import type { TxlineHttp, Query } from "./http.js";
import type { SseEvent } from "./types.js";

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const DEFAULT_DEDUPE_WINDOW = 5_000;

export interface SseHandlers {
  onEvent(event: SseEvent): void;
  onOpen?(): void;
  onGap?(reason: string): void;
  onReconnect?(attempt: number, delayMs: number): void;
}

export interface SseLoopOptions {
  http: TxlineHttp;
  path: string;
  query?: Query;
  handlers: SseHandlers;
  log: Logger;
  signal: AbortSignal;
  heartbeatTimeoutMs?: number;
  dedupeWindow?: number;
}

const TIMEOUT = Symbol("timeout");

export async function runSseLoop(opts: SseLoopOptions): Promise<void> {
  const { http, path, query, handlers, log, signal } = opts;
  const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const seen = new SlidingIdSet(opts.dedupeWindow ?? DEFAULT_DEDUPE_WINDOW);
  let lastEventId: string | undefined;
  let attempt = 0;

  while (!signal.aborted) {
    let res: Response;
    try {
      res = await http.openStream(path, query, lastEventId, signal);
    } catch (err) {
      if (signal.aborted) break;
      const delay = backoff(attempt++);
      handlers.onReconnect?.(attempt, delay);
      log.warn(`SSE ${path} connect failed; retrying`, { err: String(err), delayMs: delay });
      await sleep(delay, signal);
      continue;
    }

    const body = res.body;
    if (!body) {
      await sleep(backoff(attempt++), signal);
      continue;
    }

    attempt = 0;
    handlers.onOpen?.();
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (!signal.aborted) {
        const chunk = await readWithTimeout(reader, heartbeatTimeoutMs);
        if (chunk === TIMEOUT) {
          handlers.onGap?.("heartbeat timeout");
          log.warn(`SSE ${path} heartbeat gap; reconnecting`);
          break;
        }
        if (chunk.done) break;

        buffer = (buffer + decoder.decode(chunk.value, { stream: true }))
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");

        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = parseFrame(frame);
          if (!event) continue;
          if (event.id) lastEventId = event.id;
          if (event.event === "heartbeat") continue;
          if (event.id && seen.has(event.id)) continue;
          if (event.id) seen.add(event.id);
          handlers.onEvent(event);
        }
      }
    } catch (err) {
      if (!signal.aborted) log.warn(`SSE ${path} read error`, { err: String(err) });
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    if (signal.aborted) break;
    const delay = backoff(attempt++);
    handlers.onReconnect?.(attempt, delay);
    await sleep(delay, signal);
  }
}

function parseFrame(frame: string): SseEvent | null {
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (id === undefined && event === undefined && dataLines.length === 0) return null;
  return { id, event, data: dataLines.join("\n") };
}

type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadResult | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function backoff(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class SlidingIdSet {
  private readonly set = new Set<string>();
  private readonly queue: string[] = [];
  constructor(private readonly max: number) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    this.set.add(id);
    this.queue.push(id);
    if (this.queue.length > this.max) {
      const evicted = this.queue.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
  }
}
