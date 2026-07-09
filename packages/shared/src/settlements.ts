/**
 * Settlement — the call-level outcome. The Phase 3 settle engine implements a
 * `SettleFn` per template that is pure (only reads its inputs), total (every path
 * yields settled or void), and idempotent (re-running over the same ordered
 * messages yields the same result). Void is a first-class, honest outcome.
 */

import type { FeedMessageId, SettlementId, CallId } from "./ids.js";
import type { Call, CallOptionId } from "./calls.js";
import type { FeedGap, MatchEvent } from "./events.js";
import type { FixtureStatus } from "./fixtures.js";
import type { OddsSnapshot } from "./odds.js";
import type { FeedTimestamp } from "./time.js";

export type VoidReason =
  | "feed-gap"
  | "abandoned"
  | "unresolved-window"
  | "late-answer"
  | "odds-unavailable"
  | "stat-unsupported";

export type SettleOutcome =
  | { status: "settled"; winningOption: CallOptionId }
  | { status: "void"; reason: VoidReason };

/** Everything a settle function may read. Ordered, deduped, scoped to one fixture. */
export interface SettleContext {
  events: readonly MatchEvent[];
  odds?: readonly OddsSnapshot[];
  gaps: readonly FeedGap[];
  fixtureStatus: FixtureStatus;
}

/** The compiled form of a call template: pure, total, idempotent. */
export type SettleFn = (call: Call, ctx: SettleContext) => SettleOutcome;

export interface Settlement {
  id: SettlementId;
  callId: CallId;
  outcome: SettleOutcome;
  /** Feed time at which the outcome became determined; null for void. */
  settledAtFeedTs: FeedTimestamp | null;
  /** Feed messages that determined the outcome — the receipt/audit trail. */
  decidingMessageIds: FeedMessageId[];
}
