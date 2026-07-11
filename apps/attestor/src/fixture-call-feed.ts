import type { Call } from "../../../packages/shared/src/calls.js";
import { decodeFixturePlaneRecord } from "../../../packages/shared/src/fixture-plane.js";

import { AttestorError } from "./errors.js";
import { b4a, type HypercoreLike } from "./holepunch.js";

export interface IndexedCall {
  call: Call;
  feedIndex: number;
}

export interface FixtureFeedHead {
  key: string;
  fork: number;
  length: number;
  treeHash: string;
}

export class FixtureCallFeed {
  readonly core: HypercoreLike;
  readonly key: string;

  private readonly calls = new Map<string, IndexedCall>();
  private readonly settled = new Set<string>();
  private cursor = 0;
  private projectionFork = -1;
  private refreshTail: Promise<void> = Promise.resolve();

  constructor(core: HypercoreLike, expectedKey: string) {
    this.core = core;
    this.key = expectedKey;
  }

  async open(): Promise<void> {
    await this.core.ready();
    if (b4a.toString(this.core.key, "hex") !== this.key) {
      throw new Error("Corestore opened a different fixture feed key");
    }
    await this.refresh(false);
  }

  refresh(waitForBlocks = true): Promise<void> {
    const next = this.refreshTail.then(() => this.refreshNow(waitForBlocks));
    this.refreshTail = next.catch(() => undefined);
    return next;
  }

  requireOpenCall(callId: string): IndexedCall {
    if (this.settled.has(callId)) {
      throw new AttestorError("CALL_SETTLED", `Call ${callId} has already settled`);
    }
    const indexed = this.calls.get(callId);
    if (!indexed) {
      throw new AttestorError("CALL_UNKNOWN", `Call ${callId} is not available from the pinned fixture feed`, true);
    }
    return indexed;
  }

  async head(): Promise<FixtureFeedHead> {
    if (this.cursor < 1) throw new AttestorError("FEED_UNAVAILABLE", "Pinned fixture feed has no locally verified head", true);
    const length = this.cursor;
    return {
      key: this.key,
      fork: this.core.fork,
      length,
      treeHash: b4a.toString(await this.core.treeHash(length), "hex"),
    };
  }

  private async refreshNow(waitForBlocks: boolean): Promise<void> {
    try {
      await this.core.update({ wait: false });
      if (this.projectionFork !== this.core.fork || this.core.length < this.cursor) {
        this.calls.clear();
        this.settled.clear();
        this.cursor = 0;
        this.projectionFork = this.core.fork;
      }
      const target = this.core.length;
      while (this.cursor < target) {
        const block = await this.core.get(this.cursor, waitForBlocks
          ? { wait: true, timeout: 5_000 }
          : { wait: false });
        if (!block) break;
        this.apply(block, this.cursor);
        this.cursor += 1;
      }
    } catch (error) {
      throw new AttestorError(
        "FEED_UNAVAILABLE",
        error instanceof Error ? `Pinned fixture feed is unavailable: ${error.message}` : "Pinned fixture feed is unavailable",
        true,
      );
    }
  }

  private apply(block: Uint8Array, index: number): void {
    const record = decodeFixturePlaneRecord(block);
    if (record.kind === "call.open") {
      const existing = this.calls.get(record.call.id);
      if (existing && JSON.stringify(existing.call) !== JSON.stringify(record.call)) {
        throw new Error(`Pinned fixture feed contains conflicting call ${record.call.id}`);
      }
      if (!existing) this.calls.set(record.call.id, { call: record.call, feedIndex: index });
    } else if (record.kind === "call.settled") {
      const opened = this.calls.get(record.settlement.callId);
      if (opened && opened.call.fixtureId !== record.fixtureId) {
        throw new Error(`Pinned fixture feed settlement fixture does not match call ${record.settlement.callId}`);
      }
      this.settled.add(record.settlement.callId);
    }
  }
}
