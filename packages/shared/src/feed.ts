/**
 * Feed transport model — the envelope around every TxLINE message plus the
 * on-disk corpus record shape.
 *
 * The recorder writes exact wire payloads (`RawFeedRecord`) alongside normalized
 * state snapshots (`SnapshotFeedRecord`); the same corpus drives settle-engine
 * tests, replay mode, and the demo. Ordering and dedupe are pure so the worker,
 * the tests, and replay all agree on message order.
 */

import type { FeedMessageId, FixtureId } from "./ids";
import type { FeedTimestamp } from "./time";

export type FeedSource = "scores" | "odds";

/** A normalized, in-memory message once we've located its ordering fields. */
export interface FeedEnvelope<TPayload = unknown> {
  source: FeedSource;
  fixtureId: FixtureId | null;
  messageId: FeedMessageId | null;
  feedTs: FeedTimestamp | null;
  payload: TPayload;
}

/** Exact wire payload as recorded, with both feed time and local receipt time. */
export interface RawFeedRecord {
  kind: "raw";
  source: FeedSource;
  fixtureId: string | null;
  messageId: string | null;
  feedTs: number | null;
  /** WallClock ms when the worker received the message. */
  receivedAt: number;
  payload: unknown;
}

/** A normalized fixture-state snapshot at a point in feed time. */
export interface SnapshotFeedRecord {
  kind: "snapshot";
  fixtureId: string;
  feedTs: number | null;
  recordedAt: number;
  snapshot: unknown;
}

export type CorpusRecord = RawFeedRecord | SnapshotFeedRecord;

interface FeedOrdered {
  feedTs: FeedTimestamp | null;
  messageId: FeedMessageId | null;
}

/**
 * Total order over feed messages: feed time first, message id as a stable
 * tiebreak. Messages missing a feed time sort last (unknown time = latest),
 * so a malformed/heartbeat message can't reorder settled events ahead of them.
 */
export function compareFeedOrder(a: FeedOrdered, b: FeedOrdered): number {
  const at = a.feedTs ?? Number.MAX_SAFE_INTEGER;
  const bt = b.feedTs ?? Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  return String(a.messageId ?? "").localeCompare(String(b.messageId ?? ""));
}

/**
 * Drop duplicate messages by message id, keeping the first occurrence. Messages
 * without a message id are always kept (they can't be proven duplicate).
 */
export function dedupeByMessageId<T extends FeedOrdered>(messages: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const message of messages) {
    if (message.messageId == null) {
      out.push(message);
      continue;
    }
    if (seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    out.push(message);
  }
  return out;
}

/** Dedupe then order — the canonical preprocessing before any settle pass. */
export function orderFeed<T extends FeedOrdered>(messages: readonly T[]): T[] {
  return dedupeByMessageId(messages).sort(compareFeedOrder);
}
