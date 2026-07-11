import assert from "node:assert/strict";
import test from "node:test";

import {
  asCallId,
  asFeedMessageId,
  asFeedTimestamp,
  asFixtureId,
  asMatchEventId,
  callsForEvent,
  evaluateCall,
  type Call,
  type MatchEvent,
  type SettleContext,
} from "../src/index";

const fixtureId = asFixtureId("fixture-1");
const start = asFeedTimestamp(1_800_000_000_000);

function event(kind: MatchEvent["kind"], seconds: number, side: MatchEvent["side"] = null): MatchEvent {
  return {
    id: asMatchEventId(`event:${kind}:${seconds}`),
    fixtureId,
    kind,
    feedTs: asFeedTimestamp(start + seconds * 1_000),
    messageId: asFeedMessageId(`message:${seconds}`),
    minute: Math.floor(seconds / 60),
    side,
  };
}

function context(overrides: Partial<SettleContext> = {}): SettleContext {
  return {
    events: [],
    gaps: [],
    fixtureStatus: "first-half",
    fixtureMinute: 1,
    frontierFeedTs: asFeedTimestamp(start + 60_000),
    ...overrides,
  };
}

test("call scheduler emits stable calls for signed phase and scoring events", () => {
  const kickoff = event("kickoff", 0);
  const first = callsForEvent(kickoff);
  const replayed = callsForEvent(kickoff);
  assert.equal(first.length, 2);
  assert.deepEqual(first, replayed);
  assert.equal(first[0]?.id, `call:${kickoff.id}:opening-goal`);
  assert.deepEqual(callsForEvent(event("yellow-card", 60)), []);
  assert.equal(callsForEvent(event("goal", 120, "home")).length, 1);
});

test("window calls settle yes on the deciding signed event and remain idempotent", () => {
  const call = callsForEvent(event("kickoff", 0))[0]!;
  const goal = event("goal", 120, "home");
  const ctx = context({ events: [goal], frontierFeedTs: goal.feedTs, fixtureMinute: 2 });
  const first = evaluateCall(call, ctx);
  const second = evaluateCall(call, ctx);
  assert.deepEqual(first, second);
  assert.equal(first.status, "decided");
  if (first.status === "decided") {
    assert.deepEqual(first.settlement.outcome, { status: "settled", winningOption: "yes" });
    assert.deepEqual(first.settlement.decidingMessageIds, [goal.messageId]);
  }
});

test("calls remain pending before their signed frontier and settle no after it", () => {
  const call = callsForEvent(event("kickoff", 0))[0]!;
  assert.deepEqual(evaluateCall(call, context()), { status: "pending" });
  const result = evaluateCall(
    call,
    context({ frontierFeedTs: call.settlesBy, fixtureMinute: 10 }),
  );
  assert.equal(result.status, "decided");
  if (result.status === "decided") {
    assert.deepEqual(result.settlement.outcome, { status: "settled", winningOption: "no" });
  }
});

test("next-goal calls use the first canonical goal side", () => {
  const call = callsForEvent(event("kickoff", 0))[1]!;
  const away = event("goal", 180, "away");
  const home = event("goal", 240, "home");
  const result = evaluateCall(
    call,
    context({ events: [home, away], frontierFeedTs: home.feedTs, fixtureMinute: 4 }),
  );
  assert.equal(result.status, "decided");
  if (result.status === "decided") {
    assert.deepEqual(result.settlement.outcome, { status: "settled", winningOption: "away" });
  }
});

test("a feed gap or abandoned fixture voids a call honestly", () => {
  const call = callsForEvent(event("kickoff", 0))[0]!;
  const withGap = evaluateCall(
    call,
    context({
      gaps: [{ fromFeedTs: start, toFeedTs: asFeedTimestamp(start + 1_000), detectedAt: 1 }],
    }),
  );
  assert.equal(withGap.status, "decided");
  if (withGap.status === "decided") assert.equal(withGap.settlement.outcome.status, "void");

  const abandoned = evaluateCall(call, context({ fixtureStatus: "abandoned" }));
  assert.equal(abandoned.status, "decided");
  if (abandoned.status === "decided") {
    assert.deepEqual(abandoned.settlement.outcome, { status: "void", reason: "abandoned" });
  }
});

test("threshold and crowd templates have deterministic terminal outcomes", () => {
  const threshold: Call = {
    ...callsForEvent(event("kickoff", 0))[0]!,
    id: asCallId("call:threshold"),
    template: "threshold",
    spec: { kind: "threshold", metric: "corners", atLeast: 2, beforeMinute: 10 },
  };
  const corners = [event("corner", 120, "home"), event("corner", 180, "away")];
  const thresholdResult = evaluateCall(
    threshold,
    context({ events: corners, frontierFeedTs: corners[1]!.feedTs, fixtureMinute: 3 }),
  );
  assert.equal(thresholdResult.status, "decided");
  if (thresholdResult.status === "decided") {
    assert.deepEqual(thresholdResult.settlement.outcome, { status: "settled", winningOption: "yes" });
  }

  const crowd: Call = {
    ...threshold,
    id: asCallId("call:crowd"),
    template: "crowd",
    spec: { kind: "crowd" },
    options: [{ id: "home", label: "Home" }, { id: "away", label: "Away" }],
  };
  const crowdResult = evaluateCall(
    crowd,
    context({ frontierFeedTs: crowd.settlesBy, crowdTallies: { home: 7, away: 3 } }),
  );
  assert.equal(crowdResult.status, "decided");
  if (crowdResult.status === "decided") {
    assert.deepEqual(crowdResult.settlement.outcome, { status: "settled", winningOption: "home" });
  }
});

test("market calls void when signed odds evidence is unavailable", () => {
  const market: Call = {
    ...callsForEvent(event("kickoff", 0))[0]!,
    id: asCallId("call:market-unavailable"),
    template: "market-read",
    spec: { kind: "market-read", retraceFraction: 0.5, withinMinutes: 5 },
  };
  const result = evaluateCall(
    market,
    context({ frontierFeedTs: market.settlesBy, odds: [] }),
  );
  assert.equal(result.status, "decided");
  if (result.status === "decided") {
    assert.deepEqual(result.settlement.outcome, { status: "void", reason: "odds-unavailable" });
  }
});
