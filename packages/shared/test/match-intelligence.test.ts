import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asFeedMessageId,
  asFeedTimestamp,
  asFixtureId,
  asMatchEventId,
  callPoints,
  difficultyMultiplier,
  projectAcceptedReceiptState,
  projectMarketSays,
  projectPressure,
  type MatchEvent,
  type OddsSnapshot,
} from "../src/index";

const fixtureId = asFixtureId("fixture:intelligence:1");

const events: MatchEvent[] = [
  {
    id: asMatchEventId("fixture:intelligence:1:goal:1"),
    fixtureId,
    kind: "goal",
    feedTs: asFeedTimestamp(1_000),
    messageId: asFeedMessageId("fixture:intelligence:1:score:1"),
    minute: 12,
    side: "home",
    score: { home: 1, away: 0 },
  },
  {
    id: asMatchEventId("fixture:intelligence:1:shot:2"),
    fixtureId,
    kind: "shot-on-target",
    feedTs: asFeedTimestamp(1_100),
    messageId: asFeedMessageId("fixture:intelligence:1:score:2"),
    minute: 13,
    side: "away",
  },
];

const odds: OddsSnapshot[] = [
  {
    fixtureId,
    feedTs: asFeedTimestamp(900),
    messageId: asFeedMessageId("fixture:intelligence:odds:1"),
    decimal: { home: 2, draw: 3, away: 5 },
  },
  {
    fixtureId,
    feedTs: asFeedTimestamp(1_050),
    messageId: asFeedMessageId("fixture:intelligence:odds:2"),
    decimal: { home: 1.5, draw: 4, away: 6 },
  },
];

test("Market Says cards carry signed odds and event evidence", () => {
  const cards = projectMarketSays(fixtureId, odds, events);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.id, "market:fixture:intelligence:1:fixture:intelligence:odds:2");
  assert.equal(cards[0]!.kind, "pressure-building");
  assert.equal(cards[0]!.evidence.precedingEventId, events[0]!.id);
  assert.equal(cards[0]!.evidence.fromImplied?.home !== undefined, true);
  assert.equal(cards[0]!.evidence.toImplied?.home !== undefined, true);
  assert.match(cards[0]!.text, /market moved toward the home side/i);
});

test("pressure is a bounded deterministic projection of fixture facts", () => {
  const first = projectPressure(fixtureId, events, odds);
  const second = projectPressure(fixtureId, [...events].reverse(), [...odds].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.feedTs, asFeedTimestamp(1_100));
  assert.equal(first.eventCount, 2);
  assert.equal(first.oddsSnapshotCount, 2);
  assert.equal(first.value > 0 && first.value <= 1, true);
  assert.equal(first.eventContribution > 0, true);
  assert.equal(first.oddsContribution > 0, true);
});

test("scoring stays deterministic for an unlikely correct call", () => {
  const multiplier = difficultyMultiplier(0.25);
  assert.equal(multiplier, 4);
  assert.equal(callPoints(true, multiplier), 400);
  assert.equal(callPoints(false, multiplier), 0);
});

test("accepted receipts never claim an anchor until a verifier says so", () => {
  const settled = { outcome: { status: "settled" as const, winningOption: "yes" } };
  assert.equal(projectAcceptedReceiptState({ accepted: true, settlement: null, verifiedAnchor: false }), "accepted");
  assert.equal(projectAcceptedReceiptState({ accepted: true, settlement: settled, verifiedAnchor: false }), "proof-pending");
  assert.equal(projectAcceptedReceiptState({ accepted: true, settlement: settled, verifiedAnchor: true }), "anchored");
  assert.equal(projectAcceptedReceiptState({
    accepted: true,
    settlement: { outcome: { status: "void" as const, reason: "feed-gap" as const } },
    verifiedAnchor: true,
  }), "void");
  assert.throws(
    () => projectAcceptedReceiptState({ accepted: false, settlement: null, verifiedAnchor: false }),
    /unverified answer/,
  );
});
