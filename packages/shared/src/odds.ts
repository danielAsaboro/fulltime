/**
 * Odds model — feeds call difficulty and Market Says. All probability work is
 * de-vigged (bookmaker margin removed) so "improbable" means improbable, not
 * mispriced by the overround. No LLM touches this; it's deterministic math.
 */

import type { FeedMessageId, FixtureId } from "./ids.js";
import type { FeedTimestamp } from "./time.js";

export type OutcomeKey = "home" | "draw" | "away";

export interface OddsSnapshot {
  fixtureId: FixtureId;
  feedTs: FeedTimestamp;
  messageId: FeedMessageId | null;
  /** Decimal odds per outcome (e.g. 1.90). */
  decimal: Record<OutcomeKey, number>;
}

export interface ImpliedProbabilities {
  home: number;
  draw: number;
  away: number;
  /** Bookmaker margin that was removed (sum of raw implied probs minus 1). */
  overround: number;
}

/**
 * Convert decimal odds to de-vigged implied probabilities. Returns null if any
 * price is non-positive (Market Says pauses and difficulty falls back to base).
 */
export function impliedFromDecimal(decimal: Record<OutcomeKey, number>): ImpliedProbabilities | null {
  const raw: Record<OutcomeKey, number> = {
    home: 1 / decimal.home,
    draw: 1 / decimal.draw,
    away: 1 / decimal.away,
  };
  const total = raw.home + raw.draw + raw.away;
  if (!Number.isFinite(total) || total <= 0) return null;
  if (decimal.home <= 0 || decimal.draw <= 0 || decimal.away <= 0) return null;
  return {
    home: raw.home / total,
    draw: raw.draw / total,
    away: raw.away / total,
    overround: total - 1,
  };
}
