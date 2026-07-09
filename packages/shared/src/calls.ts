/**
 * Fan Calls — deterministic rapid-fire prediction cards tied to match state.
 *
 * A call is data, not code: its `spec` (a discriminated union) fully describes how
 * it settles, so the Phase 3 settle engine can compile every template to one pure,
 * total, idempotent settle function over ordered feed messages. Every call resolves
 * to settled or void — never "stuck".
 *
 * Feed-time lifecycle: opened → locksAt (answers stop counting) → settlesBy (the
 * window by which the outcome must resolve; unresolved or gap-crossed ⇒ void).
 */

import type { CallId, FixtureId, RoomId } from "./ids.js";
import type { TeamSide } from "./events.js";
import type { FeedTimestamp } from "./time.js";

export type CallTemplateKind = "window" | "threshold" | "next-event" | "market-read" | "crowd";

export type CallStatus = "open" | "locked" | "settled" | "void";

/** Stable option key an answer references (e.g. "yes", "no", "home", "neither"). */
export type CallOptionId = string;

export interface CallOption {
  id: CallOptionId;
  label: string;
}

export type WindowEventKind = "shot-on-target" | "corner" | "goal" | "card";

export type ThresholdMetric = "corners" | "goals" | "cards" | "shots-on-target";

/**
 * Full settlement parameters per template. The engine reads only `spec` (plus the
 * ordered event stream) to decide the outcome — no hidden state.
 */
export type CallSpec =
  | { kind: "window"; event: WindowEventKind; withinMinutes: number; side?: TeamSide }
  | { kind: "threshold"; metric: ThresholdMetric; atLeast: number; beforeMinute: number; side?: TeamSide }
  | { kind: "next-event"; event: "goal"; beforeMinute?: number }
  | { kind: "market-read"; retraceFraction: number; withinMinutes: number }
  | { kind: "crowd" };

export interface Call {
  id: CallId;
  fixtureId: FixtureId;
  /** null ⇒ a match-wide call fanned out to every room for this fixture. */
  roomId: RoomId | null;
  template: CallTemplateKind;
  spec: CallSpec;
  /** Fan-facing question, e.g. "Shot on target in the next 5 minutes?" */
  prompt: string;
  options: CallOption[];
  openedAt: FeedTimestamp;
  locksAt: FeedTimestamp;
  settlesBy: FeedTimestamp;
  /** Scored calls affect Fan IQ; social/crowd calls do not. */
  scored: boolean;
  status: CallStatus;
  /**
   * De-vigged difficulty captured at lock (0..1, lower implied prob ⇒ higher
   * payout). Null when odds were unavailable and difficulty falls back to base.
   */
  difficulty?: number | null;
}
