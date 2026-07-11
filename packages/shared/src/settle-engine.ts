/**
 * Pure call settlement over publisher-signed fixture facts.
 *
 * The engine never reads wall clock or room state. A caller
 * may evaluate after every signed fixture update; it returns `pending` until the
 * outcome is knowable, then returns the same settlement for the same inputs.
 */

import type { Call, CallOptionId, WindowEventKind } from "./calls";
import type { FeedMessageId, SettlementId } from "./ids";
import { asSettlementId } from "./ids";
import { impliedFromDecimal, type ImpliedProbabilities, type OutcomeKey } from "./odds";
import type {
  SettleContext,
  Settlement,
  SettlementDecision,
  SettleOutcome,
} from "./settlements";
import type { FeedTimestamp } from "./time";

const TERMINAL = new Set([
  "full-time",
  "after-extra-time",
  "after-penalties",
  "abandoned",
  "cancelled",
]);
const ABANDONED = new Set(["abandoned", "cancelled"]);
const MIN_MARKET_MOVE = 0.05;

interface Winner {
  option: CallOptionId;
  feedTs: FeedTimestamp;
  messageIds: FeedMessageId[];
}

export function evaluateCall(call: Call, context: SettleContext): SettlementDecision {
  validateCallWindow(call);
  const gap = context.gaps.find(
    (candidate) => candidate.fromFeedTs <= call.settlesBy && candidate.toFeedTs >= call.openedAt,
  );
  if (gap) return decided(call, { status: "void", reason: "feed-gap" }, null, []);
  if (ABANDONED.has(context.fixtureStatus)) {
    return decided(call, { status: "void", reason: "abandoned" }, null, []);
  }

  const winner = winnerFor(call, context);
  if (winner) {
    if (!call.options.some((option) => option.id === winner.option)) {
      return decided(call, { status: "void", reason: "stat-unsupported" }, null, []);
    }
    return decided(
      call,
      { status: "settled", winningOption: winner.option },
      winner.feedTs,
      winner.messageIds,
    );
  }

  const windowComplete = context.frontierFeedTs >= call.settlesBy || TERMINAL.has(context.fixtureStatus);
  if (!windowComplete) return { status: "pending" };

  // A missing odds baseline or a completely missing in-window quote cannot be
  // interpreted as "the market did not retrace".  That would turn an upstream
  // data outage into a scored No.  Market calls are only scoreable when both
  // sides of the comparison exist in the signed feed.
  if (call.spec.kind === "market-read" && !hasMarketEvidence(call, context)) {
    return decided(call, { status: "void", reason: "odds-unavailable" }, null, []);
  }

  const fallback = fallbackWinner(call, context);
  if (fallback && call.options.some((option) => option.id === fallback)) {
    return decided(
      call,
      { status: "settled", winningOption: fallback },
      context.frontierFeedTs < call.settlesBy ? context.frontierFeedTs : call.settlesBy,
      [],
    );
  }
  return decided(call, { status: "void", reason: "unresolved-window" }, null, []);
}

function winnerFor(call: Call, context: SettleContext): Winner | null {
  switch (call.spec.kind) {
    case "window": {
      const spec = call.spec;
      const event = orderedEvents(call, context).find(
        (candidate) =>
          matchesWindowEvent(candidate.kind, spec.event) &&
          (spec.side === undefined || candidate.side === spec.side),
      );
      return event
        ? {
            option: "yes",
            feedTs: event.feedTs,
            messageIds: event.messageId ? [event.messageId] : [],
          }
        : null;
    }
    case "threshold": {
      const spec = call.spec;
      const matching = orderedEvents(call, context).filter(
        (event) =>
          event.minute !== null &&
          event.minute <= spec.beforeMinute &&
          matchesThresholdMetric(event.kind, spec.metric) &&
          (spec.side === undefined || event.side === spec.side),
      );
      if (matching.length < spec.atLeast) return null;
      const deciding = matching[spec.atLeast - 1];
      return deciding
        ? {
            option: "yes",
            feedTs: deciding.feedTs,
            messageIds: deciding.messageId ? [deciding.messageId] : [],
          }
        : null;
    }
    case "next-event": {
      const spec = call.spec;
      const goal = orderedEvents(call, context).find(
        (event) =>
          isGoal(event.kind) &&
          (spec.beforeMinute === undefined ||
            (event.minute !== null && event.minute <= spec.beforeMinute)),
      );
      if (!goal) return null;
      return {
        option: goal.side ?? "neither",
        feedTs: goal.feedTs,
        messageIds: goal.messageId ? [goal.messageId] : [],
      };
    }
    case "market-read":
      return marketRetraceWinner(call, context);
    case "crowd":
      return null;
  }
}

function fallbackWinner(call: Call, context: SettleContext): CallOptionId | null {
  switch (call.spec.kind) {
    case "window":
    case "threshold":
    case "market-read":
      return "no";
    case "next-event":
      return "neither";
    case "crowd": {
      if (!context.crowdTallies) return null;
      const ordered = call.options
        .map((option) => ({ id: option.id, count: context.crowdTallies?.[option.id] ?? 0 }))
        .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
      if (!ordered[0] || ordered[0].count === 0 || ordered[0].count === ordered[1]?.count) return null;
      return ordered[0].id;
    }
  }
}

function marketRetraceWinner(call: Call, context: SettleContext): Winner | null {
  if (call.spec.kind !== "market-read" || !context.odds?.length) return null;
  const odds = [...context.odds].sort(
    (left, right) => left.feedTs - right.feedTs || String(left.messageId).localeCompare(String(right.messageId)),
  );
  const baselineSnapshot = [...odds].reverse().find((snapshot) => snapshot.feedTs <= call.openedAt);
  if (!baselineSnapshot) return null;
  const baseline = impliedFromDecimal(baselineSnapshot.decimal);
  if (!baseline) return null;
  const peak = { home: 0, draw: 0, away: 0 } satisfies Record<OutcomeKey, number>;
  for (const snapshot of odds) {
    if (snapshot.feedTs <= call.openedAt || snapshot.feedTs > call.settlesBy) continue;
    const current = impliedFromDecimal(snapshot.decimal);
    if (!current) continue;
    for (const outcome of ["home", "draw", "away"] as const) {
      const displacement = Math.abs(current[outcome] - baseline[outcome]);
      peak[outcome] = Math.max(peak[outcome], displacement);
      if (
        peak[outcome] >= MIN_MARKET_MOVE &&
        displacement <= peak[outcome] * (1 - call.spec.retraceFraction)
      ) {
        return {
          option: "yes",
          feedTs: snapshot.feedTs,
          messageIds: snapshot.messageId ? [snapshot.messageId] : [],
        };
      }
    }
  }
  return null;
}

function hasMarketEvidence(call: Call, context: SettleContext): boolean {
  if (call.spec.kind !== "market-read" || !context.odds?.length) return false;
  let hasBaseline = false;
  let hasWindowQuote = false;
  for (const snapshot of context.odds) {
    if (!impliedFromDecimal(snapshot.decimal)) continue;
    if (snapshot.feedTs <= call.openedAt) hasBaseline = true;
    if (snapshot.feedTs > call.openedAt && snapshot.feedTs <= call.settlesBy) hasWindowQuote = true;
    if (hasBaseline && hasWindowQuote) return true;
  }
  return false;
}

function orderedEvents(call: Call, context: SettleContext) {
  return context.events
    .filter((event) => event.feedTs > call.openedAt && event.feedTs <= call.settlesBy)
    .slice()
    .sort(
      (left, right) => left.feedTs - right.feedTs || String(left.id).localeCompare(String(right.id)),
    );
}

function matchesWindowEvent(kind: string, expected: WindowEventKind): boolean {
  if (expected === "goal") return isGoal(kind);
  if (expected === "card") return ["yellow-card", "second-yellow", "red-card"].includes(kind);
  return kind === expected;
}

function matchesThresholdMetric(kind: string, metric: string): boolean {
  if (metric === "goals") return isGoal(kind);
  if (metric === "cards") return ["yellow-card", "second-yellow", "red-card"].includes(kind);
  if (metric === "corners") return kind === "corner";
  return kind === "shot-on-target";
}

function isGoal(kind: string): boolean {
  return ["goal", "own-goal", "penalty-scored"].includes(kind);
}

function decided(
  call: Call,
  outcome: SettleOutcome,
  settledAtFeedTs: FeedTimestamp | null,
  decidingMessageIds: FeedMessageId[],
): SettlementDecision {
  const settlement: Settlement = {
    id: asSettlementId(`settlement:${call.id}`) as SettlementId,
    callId: call.id,
    outcome,
    settledAtFeedTs,
    decidingMessageIds: unique(decidingMessageIds),
  };
  return { status: "decided", settlement };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function validateCallWindow(call: Call): void {
  if (call.openedAt > call.locksAt || call.locksAt > call.settlesBy) {
    throw new TypeError(`Call ${call.id} has an invalid feed-time window`);
  }
  if (call.options.length < 2 || new Set(call.options.map((option) => option.id)).size !== call.options.length) {
    throw new TypeError(`Call ${call.id} has invalid options`);
  }
  if (call.spec.kind === "market-read" &&
      (!Number.isFinite(call.spec.retraceFraction) || call.spec.retraceFraction <= 0 || call.spec.retraceFraction > 1)) {
    throw new TypeError(`Call ${call.id} has an invalid market retrace fraction`);
  }
}

export function probabilities(snapshot: { decimal: Record<OutcomeKey, number> }): ImpliedProbabilities | null {
  return impliedFromDecimal(snapshot.decimal);
}
