/**
 * Realtime transport. Room channels are per-room and send diffs, not full
 * snapshots. Every message carries the feed time of the moment it represents, so
 * the client release queue can hold it until `feed_ts + D` — this is how one
 * server broadcast reaches every viewer spoiler-safe on their own clock.
 */

import type { CallId, PollId, RoomId } from "./ids.js";
import type { Call } from "./calls.js";
import type { FixtureState, MatchEvent } from "./events.js";
import type { MarketSaysCard } from "./market-says.js";
import type { Receipt } from "./receipts.js";
import type { Note, Reaction, Poll } from "./social.js";
import type { Settlement } from "./settlements.js";
import type { FeedTimestamp, WallClock } from "./time.js";

export type RoomDiff =
  | { type: "fixture.state"; state: FixtureState }
  | { type: "match.event"; event: MatchEvent }
  | { type: "call.opened"; call: Call }
  | { type: "call.locked"; callId: CallId }
  | { type: "call.settled"; settlement: Settlement }
  | { type: "reaction"; reaction: Reaction }
  | { type: "note"; note: Note }
  | { type: "poll.opened"; poll: Poll }
  | { type: "poll.tally"; pollId: PollId; tallies: Record<string, number> }
  | { type: "market-says"; card: MarketSaysCard }
  | { type: "receipt"; receipt: Receipt }
  | { type: "crowd.pulse"; intensity: number };

export interface RoomChannelMessage {
  roomId: RoomId;
  /** Feed time this diff belongs to; null ⇒ release immediately (not spoiler-bearing). */
  feedTs: FeedTimestamp | null;
  /** Server send time, for latency compensation in the release queue. */
  sentAt: WallClock;
  diff: RoomDiff;
}
