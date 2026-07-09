/**
 * Market Says — odds movement translated into fan language with deterministic
 * templates. No LLM runs in the live loop. Every sentence must trace to feed and
 * odds deltas (the `evidence`), so it can be audited and replayed. Not betting
 * advice; a sports-context layer only (PRD §4.7).
 */

import type { FixtureId, MatchEventId } from "./ids";
import type { OutcomeKey } from "./odds";
import type { FeedTimestamp } from "./time";

export type MarketSaysKind =
  | "pressure-building"
  | "not-buying-panic"
  | "draw-compressing"
  | "muted-reaction"
  | "swing";

export interface MarketSaysEvidence {
  fromImplied?: Partial<Record<OutcomeKey, number>>;
  toImplied?: Partial<Record<OutcomeKey, number>>;
  /** The match event the move is read against, when there is one. */
  precedingEventId?: MatchEventId;
}

export interface MarketSaysCard {
  id: string;
  fixtureId: FixtureId;
  kind: MarketSaysKind;
  feedTs: FeedTimestamp;
  /** Deterministic template output. */
  text: string;
  evidence: MarketSaysEvidence;
}
