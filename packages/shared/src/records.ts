/**
 * Post-match artifacts: the per-match Fan Report and the running Tournament
 * Record. Every scored call carries its receipt state so the brag is backed by
 * proof — bragging rights nobody can fake (PRD §4.8).
 */

import type { CallId, FixtureId, RecordId, RoomId, UserId } from "./ids";
import type { CallOptionId } from "./calls";
import type { ReceiptState } from "./receipts";
import type { WallClock } from "./time";

export interface ScoredCallSummary {
  callId: CallId;
  fixtureId: FixtureId;
  prompt: string;
  chosenOption: CallOptionId;
  correct: boolean;
  points: number;
  receiptState: ReceiptState;
}

export interface FanReport {
  userId: UserId;
  roomId: RoomId;
  fixtureId: FixtureId;
  fanIq: number;
  accuracy: number;
  rank: number;
  percentile: number;
  scoredCalls: number;
  bestRead?: ScoredCallSummary;
  highestDifficultyHit?: ScoredCallSummary;
  biggestMiss?: ScoredCallSummary;
  generatedAt: WallClock;
}

export interface TournamentRecord {
  id: RecordId;
  userId: UserId;
  fanIq: number;
  accuracy: number;
  matchesPlayed: number;
  calls: ScoredCallSummary[];
  updatedAt: WallClock;
}
