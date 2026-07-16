/**
 * Deterministic, feed-backed match intelligence.
 *
 * This module is deliberately presentation-neutral.  It turns only signed match
 * events and signed odds snapshots into small, auditable projections.  It does
 * not read wall clock time, room state, or an LLM, so the same fixture history
 * always produces the same cards during a live session and during replay.
 */

import type { FixtureId, MatchEventId } from "./ids";
import type { MatchEvent, MatchEventKind } from "./events";
import { impliedFromDecimal, type OutcomeKey, type OddsSnapshot } from "./odds";
import type { FeedTimestamp } from "./time";
import type { MarketSaysCard, MarketSaysEvidence, MarketSaysKind } from "./market-says";

export interface PressureProjection {
  fixtureId: FixtureId;
  /** A bounded 0..1 presentation value, never an unsourced match fact. */
  value: number;
  /** Contribution from the recent signed event sequence, also 0..1. */
  eventContribution: number;
  /** Contribution from signed de-vigged odds movement, also 0..1. */
  oddsContribution: number;
  eventCount: number;
  oddsSnapshotCount: number;
  /** Latest signed feed timestamp used by the projection, or null when empty. */
  feedTs: FeedTimestamp | null;
}

const OUTCOMES: readonly OutcomeKey[] = ["home", "draw", "away"];
const MARKET_MOVE_THRESHOLD = 0.025;
const MARKET_SWING_THRESHOLD = 0.06;
const RECENT_EVENT_LIMIT = 8;
const RECENT_ODDS_TRANSITIONS = 6;

const EVENT_WEIGHT: Readonly<Record<MatchEventKind, number>> = {
  kickoff: 0.04,
  goal: 0.68,
  "own-goal": 0.68,
  "penalty-scored": 0.68,
  "penalty-missed": 0.52,
  "yellow-card": 0.16,
  "second-yellow": 0.36,
  "red-card": 0.44,
  substitution: 0.08,
  corner: 0.12,
  "shot-on-target": 0.24,
  "shot-off-target": 0.12,
  save: 0.18,
  var: 0.22,
  offside: 0.08,
  foul: 0.06,
  "half-time": 0.02,
  "second-half-start": 0.04,
  "extra-time-start": 0.08,
  "penalty-shootout-start": 0.16,
  "full-time": 0,
  abandoned: 0,
};

/**
 * Produce one Market Says card per material signed odds movement.
 *
 * A material move is a 2.5 percentage-point change in a de-vigged implied
 * probability.  The evidence carries both snapshots and the latest event that
 * occurred between them, so the generated sentence can always be audited.
 */
export function projectMarketSays(
  fixtureId: FixtureId,
  odds: readonly OddsSnapshot[],
  events: readonly MatchEvent[],
): MarketSaysCard[] {
  const orderedOdds = sortOdds(fixtureId, odds);
  const orderedEvents = sortEvents(fixtureId, events);
  const cards: MarketSaysCard[] = [];

  for (let index = 1; index < orderedOdds.length; index += 1) {
    const from = orderedOdds[index - 1]!;
    const to = orderedOdds[index]!;
    const fromImplied = impliedFromDecimal(from.decimal);
    const toImplied = impliedFromDecimal(to.decimal);
    if (!fromImplied || !toImplied) continue;

    const move = largestMove(fromImplied, toImplied);
    if (Math.abs(move.delta) < MARKET_MOVE_THRESHOLD) continue;
    const preceding = latestEventBetween(orderedEvents, from.feedTs, to.feedTs);
    const evidence: MarketSaysEvidence = {
      fromImplied: probabilities(fromImplied),
      toImplied: probabilities(toImplied),
      ...(preceding ? { precedingEventId: preceding.id as MatchEventId } : {}),
    };
    const kind = marketKind(move.outcome, move.delta, preceding, Math.abs(move.delta));
    cards.push({
      id: `market:${fixtureId}:${to.messageId}`,
      fixtureId,
      kind,
      feedTs: to.feedTs,
      text: marketText(kind, move.outcome, move.delta, preceding),
      evidence,
    });
  }
  return cards;
}

/**
 * Calculate an ambient pressure meter from signed sources.
 *
 * The latest eight incidents use the fixed weights above with a 0.72 decay for
 * each older incident.  Recent odds transitions contribute their largest
 * de-vigged probability movement.  The final value is 70% event activity and
 * 30% market movement, capped at one.  It is an explanatory presentation value,
 * not a score, settlement input, or betting signal.
 */
export function projectPressure(
  fixtureId: FixtureId,
  events: readonly MatchEvent[],
  odds: readonly OddsSnapshot[],
): PressureProjection {
  const orderedEvents = sortEvents(fixtureId, events);
  const orderedOdds = sortOdds(fixtureId, odds);
  const newestEvents = orderedEvents.slice(-RECENT_EVENT_LIMIT).reverse();
  const eventContribution = clamp01(
    newestEvents.reduce((total, event, index) => total + EVENT_WEIGHT[event.kind] * Math.pow(0.72, index), 0) / 1.2,
  );

  let oddsImpulse = 0;
  const transitions = orderedOdds.slice(-(RECENT_ODDS_TRANSITIONS + 1));
  for (let index = 1; index < transitions.length; index += 1) {
    const before = impliedFromDecimal(transitions[index - 1]!.decimal);
    const after = impliedFromDecimal(transitions[index]!.decimal);
    if (!before || !after) continue;
    oddsImpulse += Math.abs(largestMove(before, after).delta);
  }
  const oddsContribution = clamp01(oddsImpulse / 0.18);
  const latestEvent = orderedEvents.at(-1)?.feedTs ?? null;
  const latestOdds = orderedOdds.at(-1)?.feedTs ?? null;

  return {
    fixtureId,
    value: clamp01(eventContribution * 0.7 + oddsContribution * 0.3),
    eventContribution,
    oddsContribution,
    eventCount: orderedEvents.length,
    oddsSnapshotCount: orderedOdds.length,
    feedTs: maxFeedTs(latestEvent, latestOdds),
  };
}

function sortEvents(fixtureId: FixtureId, events: readonly MatchEvent[]): MatchEvent[] {
  return events
    .filter((event) => event.fixtureId === fixtureId)
    .slice()
    .sort((left, right) => Number(left.feedTs) - Number(right.feedTs) || String(left.id).localeCompare(String(right.id)));
}

function sortOdds(fixtureId: FixtureId, odds: readonly OddsSnapshot[]): OddsSnapshot[] {
  return odds
    .filter((snapshot) => snapshot.fixtureId === fixtureId)
    .slice()
    .sort((left, right) => Number(left.feedTs) - Number(right.feedTs) || String(left.messageId).localeCompare(String(right.messageId)));
}

function probabilities(value: ReturnType<typeof impliedFromDecimal> & object): Record<OutcomeKey, number> {
  return { home: value.home, draw: value.draw, away: value.away };
}

function largestMove(
  from: NonNullable<ReturnType<typeof impliedFromDecimal>>,
  to: NonNullable<ReturnType<typeof impliedFromDecimal>>,
): { outcome: OutcomeKey; delta: number } {
  let selected: OutcomeKey = "home";
  let delta = to.home - from.home;
  for (const outcome of OUTCOMES.slice(1)) {
    const candidate = to[outcome] - from[outcome];
    if (Math.abs(candidate) > Math.abs(delta) ||
      (Math.abs(candidate) === Math.abs(delta) && outcome.localeCompare(selected) < 0)) {
      selected = outcome;
      delta = candidate;
    }
  }
  return { outcome: selected, delta };
}

function latestEventBetween(
  events: readonly MatchEvent[],
  after: FeedTimestamp,
  until: FeedTimestamp,
): MatchEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.feedTs > until) continue;
    if (event.feedTs > after) return event;
    return null;
  }
  return null;
}

function marketKind(
  outcome: OutcomeKey,
  delta: number,
  preceding: MatchEvent | null,
  magnitude: number,
): MarketSaysKind {
  if (outcome === "draw" && delta > 0) return "draw-compressing";
  if (preceding && goalLike(preceding.kind) && delta < 0) return "not-buying-panic";
  if (preceding && pressureEvent(preceding.kind) && delta > 0) return "pressure-building";
  if (magnitude >= MARKET_SWING_THRESHOLD) return "swing";
  return "muted-reaction";
}

function marketText(
  kind: MarketSaysKind,
  outcome: OutcomeKey,
  delta: number,
  preceding: MatchEvent | null,
): string {
  const side = outcome === "home" ? "the home side" : outcome === "away" ? "the away side" : "a draw";
  const event = preceding ? eventLabel(preceding.kind) : null;
  switch (kind) {
    case "pressure-building":
      return event ? `After the ${event}, the market moved toward ${side}.` : `The market moved toward ${side}.`;
    case "not-buying-panic":
      return event ? `After the ${event}, the market moved away from ${side}.` : `The market moved away from ${side}.`;
    case "draw-compressing":
      return "The market has tightened around a draw.";
    case "swing":
      return `A sharp market swing moved ${delta > 0 ? "toward" : "away from"} ${side}.`;
    case "muted-reaction":
      return event ? `The market made a measured move after the ${event}.` : "The market made a measured move.";
  }
}

function goalLike(kind: MatchEventKind): boolean {
  return kind === "goal" || kind === "own-goal" || kind === "penalty-scored" || kind === "penalty-missed";
}

function pressureEvent(kind: MatchEventKind): boolean {
  return goalLike(kind) || kind === "shot-on-target" || kind === "corner" || kind === "red-card" || kind === "second-yellow";
}

function eventLabel(kind: MatchEventKind): string {
  return kind.replace(/-/g, " ");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function maxFeedTs(left: FeedTimestamp | null, right: FeedTimestamp | null): FeedTimestamp | null {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}

/** Pulse-style ambient match narrative. Presentation only — never settlement input. */
export type MatchStoryTone = "kickoff" | "control" | "pressure" | "goal" | "break" | "closing" | "idle";

export interface MatchStoryCard {
  tone: MatchStoryTone;
  headline: string;
  detail: string;
  /** Latest signed feed timestamp used for the story, if any. */
  feedTs: FeedTimestamp | null;
  eventId: MatchEventId | null;
}

export interface MatchStoryInput {
  fixtureId: FixtureId;
  homeName: string;
  awayName: string;
  events: readonly MatchEvent[];
  pressure: PressureProjection | null;
  minute: number | null;
  phase: "upcoming" | "live" | "finished";
}

/**
 * One-line "what the match feels like" from signed events + pressure.
 * Same inputs always yield the same card (live and replay).
 */
export function projectMatchStory(input: MatchStoryInput): MatchStoryCard {
  const ordered = sortEvents(input.fixtureId, input.events);
  const latest = ordered.at(-1) ?? null;
  const pressure = input.pressure?.value ?? 0;
  const home = input.homeName.trim() || "Home";
  const away = input.awayName.trim() || "Away";

  if (input.phase === "upcoming" || ordered.length === 0) {
    return {
      tone: "idle",
      headline: "Waiting for signed kickoff",
      detail: `${home} vs ${away} — the room is quiet until the fixture feed moves.`,
      feedTs: input.pressure?.feedTs ?? null,
      eventId: null,
    };
  }

  if (input.phase === "finished" || latest?.kind === "full-time" || latest?.kind === "abandoned") {
    const score = latest?.score;
    const line = score ? `${score.home}–${score.away}` : "full time";
    return {
      tone: "closing",
      headline: `Full time · ${line}`,
      detail: "Calls settle from feed truth. Receipts stay with the room.",
      feedTs: latest?.feedTs ?? null,
      eventId: latest?.id ?? null,
    };
  }

  if (latest && goalLike(latest.kind)) {
    const side = teamLabel(latest.side, home, away);
    const score = latest.score ? ` · ${latest.score.home}–${latest.score.away}` : "";
    return {
      tone: "goal",
      headline: `${side} goal${score}`,
      detail: latest.detail
        ? `${latest.detail}${latest.minute != null ? ` · ${latest.minute}'` : ""}`
        : `Signed ${eventLabel(latest.kind)}${latest.minute != null ? ` at ${latest.minute}'` : ""}.`,
      feedTs: latest.feedTs,
      eventId: latest.id,
    };
  }

  if (latest && (latest.kind === "half-time" || latest.kind === "second-half-start" || latest.kind === "extra-time-start")) {
    return {
      tone: "break",
      headline: eventLabel(latest.kind),
      detail: input.minute != null ? `Match clock ${input.minute}'.` : "Phase change from the signed feed.",
      feedTs: latest.feedTs,
      eventId: latest.id,
    };
  }

  if (pressure >= 0.55 || (latest && pressureEvent(latest.kind))) {
    const side = latest ? teamLabel(latest.side, home, away) : "Either side";
    return {
      tone: "pressure",
      headline: pressure >= 0.75 ? "High danger" : "Pressure building",
      detail: latest
        ? `${side} · ${eventLabel(latest.kind)}${latest.minute != null ? ` · ${latest.minute}'` : ""}`
        : "Recent signed incidents and odds movement are stacking.",
      feedTs: latest?.feedTs ?? input.pressure?.feedTs ?? null,
      eventId: latest?.id ?? null,
    };
  }

  if (latest && (latest.kind === "kickoff" || latest.kind === "second-half-start")) {
    return {
      tone: "kickoff",
      headline: latest.kind === "kickoff" ? "We're underway" : "Second half",
      detail: `${home} vs ${away}${input.minute != null ? ` · ${input.minute}'` : ""}`,
      feedTs: latest.feedTs,
      eventId: latest.id,
    };
  }

  return {
    tone: "control",
    headline: input.minute != null ? `${input.minute}' · mid-block` : "Match in progress",
    detail: latest
      ? `Last signed: ${eventLabel(latest.kind)}${latest.side ? ` (${teamLabel(latest.side, home, away)})` : ""}`
      : "No material incident in the recent feed window.",
    feedTs: latest?.feedTs ?? null,
    eventId: latest?.id ?? null,
  };
}

function teamLabel(side: MatchEvent["side"], home: string, away: string): string {
  if (side === "home") return home;
  if (side === "away") return away;
  return "Either side";
}

/**
 * Consecutive correct scored answers from newest → oldest (Onside/FanField streak feel).
 * Pass outcomes in chronological order (oldest first).
 */
export function projectCallStreak(outcomes: readonly ("correct" | "incorrect" | "void" | "accepted" | "pending")[]): {
  current: number;
  best: number;
  lastOutcome: "correct" | "incorrect" | "void" | "accepted" | "pending" | null;
} {
  let current = 0;
  let best = 0;
  let run = 0;
  let last: (typeof outcomes)[number] | null = null;
  for (const outcome of outcomes) {
    last = outcome;
    if (outcome === "correct") {
      run += 1;
      best = Math.max(best, run);
    } else if (outcome === "incorrect") {
      run = 0;
    }
    // void / accepted / pending do not break or extend the streak
  }
  // current streak from the end
  current = 0;
  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    const outcome = outcomes[i]!;
    if (outcome === "correct") current += 1;
    else if (outcome === "incorrect") break;
  }
  return { current, best, lastOutcome: last };
}
