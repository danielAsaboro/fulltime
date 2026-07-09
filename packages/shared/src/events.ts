/**
 * Normalized match events — the timeline the room renders and the settle engine
 * reads. The fixture state machine turns raw scores-SSE messages into these,
 * message-id ordered, and folds them into a `FixtureState` snapshot.
 *
 * Some kinds (shots, corners) depend on TxLINE stat-validation coverage; calls
 * that need an unsupported stat are hidden rather than guessed (PRD §6).
 */

import type { FeedMessageId, FixtureId, MatchEventId } from "./ids";
import type { FixtureScore, FixtureStatus } from "./fixtures";
import type { FeedTimestamp } from "./time";

export type TeamSide = "home" | "away";

export type MatchEventKind =
  | "kickoff"
  | "goal"
  | "own-goal"
  | "penalty-scored"
  | "penalty-missed"
  | "yellow-card"
  | "second-yellow"
  | "red-card"
  | "substitution"
  | "corner"
  | "shot-on-target"
  | "shot-off-target"
  | "save"
  | "var"
  | "offside"
  | "foul"
  | "half-time"
  | "second-half-start"
  | "extra-time-start"
  | "penalty-shootout-start"
  | "full-time"
  | "abandoned";

export interface MatchEvent {
  id: MatchEventId;
  fixtureId: FixtureId;
  kind: MatchEventKind;
  /** Feed time of the event — authoritative for ordering, settlement, and release. */
  feedTs: FeedTimestamp;
  messageId: FeedMessageId | null;
  minute: number | null;
  side: TeamSide | null;
  /** Scoreline immediately after this event, for score-changing kinds. */
  score?: FixtureScore;
  /** Free-text detail from the feed (e.g. player) when present. */
  detail?: string;
}

/** A detected break in the feed. Calls whose settlement window crosses a gap void. */
export interface FeedGap {
  fromFeedTs: FeedTimestamp;
  toFeedTs: FeedTimestamp;
  /** WallClock ms when the worker noticed the gap (heartbeat miss / reconnect). */
  detectedAt: number;
}

/**
 * Folded state of a single fixture — the normalized snapshot the recorder writes
 * and the room hydrates from. Pure function of the ordered event stream.
 */
export interface FixtureState {
  fixtureId: FixtureId;
  status: FixtureStatus;
  minute: number | null;
  score: FixtureScore;
  lastFeedTs: FeedTimestamp | null;
  lastMessageId: FeedMessageId | null;
  gaps: FeedGap[];
}
