/**
 * Answers to calls. Every answer is stamped with both wall-clock time (when the
 * fan tapped) and the feed time in force for them. Locking is decided in feed
 * time: an answer that lands after the settling feed event plus a small grace
 * window is void-scored, and answer-time patterns feed global-leaderboard
 * deweighting (PRD §4.2). A viewer's stream delay never changes settlement.
 */

import type { AnswerId, CallId, UserId } from "./ids";
import type { CallOptionId } from "./calls";
import type { FeedTimestamp, WallClock } from "./time";

export interface Answer {
  id: AnswerId;
  callId: CallId;
  userId: UserId;
  option: CallOptionId;
  /** Real time the fan submitted. */
  submittedAt: WallClock;
  /** Feed time in force for this viewer when they answered (their release frontier). */
  feedTsAtAnswer: FeedTimestamp;
  /** Delay claimed at answer time, retained for anti-cheat weighting. */
  claimedDelaySeconds: number;
}
