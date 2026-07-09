/**
 * Scoring — Fan IQ and accuracy. Points = base × difficulty, where difficulty is
 * the de-vigged improbability of the outcome at lock time, so calling the unlikely
 * pays more. Leaderboards show Fan IQ and accuracy together so volume can't fake
 * skill; global ranking needs a minimum number of scored calls (PRD §4.6).
 */

import type { AnswerId, CallId, UserId } from "./ids";

export const BASE_CALL_POINTS = 100;
export const MAX_DIFFICULTY_MULTIPLIER = 5;
export const MIN_CALLS_FOR_GLOBAL_RANK = 5;

/**
 * Convert the de-vigged implied probability of the settled outcome into a payout
 * multiplier. Long shots pay more; the multiplier is clamped so a near-zero price
 * can't mint an unbounded score.
 */
export function difficultyMultiplier(impliedProb: number): number {
  if (!Number.isFinite(impliedProb) || impliedProb <= 0) return 1;
  return Math.min(MAX_DIFFICULTY_MULTIPLIER, Math.max(1, 1 / impliedProb));
}

/** Points for a single scored call. Void or social calls never reach here. */
export function callPoints(correct: boolean, multiplier: number): number {
  return correct ? Math.round(BASE_CALL_POINTS * multiplier) : 0;
}

export interface AnswerScore {
  answerId: AnswerId;
  callId: CallId;
  userId: UserId;
  correct: boolean;
  points: number;
  /** Difficulty multiplier applied (1 when odds were unavailable). */
  multiplier: number;
}

export interface LeaderboardEntry {
  userId: UserId;
  displayName: string;
  /** Total Fan IQ points. */
  fanIq: number;
  /** correctCalls / scoredCalls, 0..1. */
  accuracy: number;
  scoredCalls: number;
  correctCalls: number;
  /** Below `MIN_CALLS_FOR_GLOBAL_RANK` a fan is unranked on the global board. */
  globallyRanked: boolean;
}
