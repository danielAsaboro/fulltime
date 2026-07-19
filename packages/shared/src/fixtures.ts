/**
 * Fixtures — the World Cup matches TxLINE exposes. One global room is provisioned
 * per fixture (see `rooms.ts`). Status drives room lifecycle and call scheduling.
 */

import type { FixtureId } from "./ids";
import type { FeedTimestamp } from "./time";

export interface Team {
  /** TxLINE team identifier, kept as-is from the feed. */
  id: string;
  name: string;
  shortName?: string;
  /** ISO country / association code where the feed provides one. */
  country?: string;
}

export interface FixtureScore {
  home: number;
  away: number;
  /** Present only once a shootout has occurred. */
  penaltiesHome?: number;
  penaltiesAway?: number;
}

/**
 * Normalized fixture status. TxLINE reports numeric status codes; the worker's
 * fixtures loader maps those to this union (mapping verified against the live wire,
 * discrepancies logged to feedback.md). TxLINE shootout codes 11–13 are terminal
 * and map to `after-penalties`.
 */
export type FixtureStatus =
  | "scheduled"
  | "delayed"
  | "postponed"
  | "first-half"
  | "half-time"
  | "second-half"
  | "end-of-regulation"
  | "extra-time"
  | "penalty-shootout"
  | "full-time"
  | "after-extra-time"
  | "after-penalties"
  | "abandoned"
  | "cancelled"
  | "unknown";

/** Statuses after which no further live events are expected and results are final. */
export const TERMINAL_FIXTURE_STATUSES: ReadonlySet<FixtureStatus> = new Set([
  "full-time",
  "after-extra-time",
  "after-penalties",
  "abandoned",
  "cancelled",
]);

export function isTerminalFixtureStatus(status: FixtureStatus): boolean {
  return TERMINAL_FIXTURE_STATUSES.has(status);
}

/** Statuses during which the ball is in play and the call scheduler should be active. */
export const LIVE_FIXTURE_STATUSES: ReadonlySet<FixtureStatus> = new Set([
  "first-half",
  "second-half",
  "extra-time",
  "penalty-shootout",
]);

export function isLiveFixtureStatus(status: FixtureStatus): boolean {
  return LIVE_FIXTURE_STATUSES.has(status);
}

export interface Fixture {
  id: FixtureId;
  competition: string;
  home: Team;
  away: Team;
  /** Scheduled kickoff in feed time. */
  kickoff: FeedTimestamp;
  status: FixtureStatus;
  /** Original TxLINE numeric status code, retained for auditing the mapping. */
  rawStatusCode?: number;
  /** Current match minute when live. */
  minute?: number | null;
  score?: FixtureScore;
}
