import assert from "node:assert/strict";
import test from "node:test";

import {
  asAnswerId,
  asCallId,
  asFeedTimestamp,
  asFixtureId,
  asReceiptId,
  asRecordId,
  asRoomId,
  asSettlementId,
  asUserId,
  asWallClock,
  buildFanReport,
  buildLeaderboard,
  buildTournamentRecord,
  scoreAnswer,
  verifyReceipt,
  verifyScoredArtifact,
  type Answer,
  type Call,
  type Receipt,
  type ScoredArtifact,
  type Settlement,
} from "../src/index";

const user = asUserId("peer-user");
const other = asUserId("peer-other");
const fixtureId = asFixtureId("fixture-1");
const callId = asCallId("call-1");

const call: Call = {
  id: callId,
  fixtureId,
  roomId: null,
  template: "window",
  spec: { kind: "window", event: "goal", withinMinutes: 5 },
  prompt: "Goal?",
  options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
  openedAt: asFeedTimestamp(100),
  locksAt: asFeedTimestamp(200),
  settlesBy: asFeedTimestamp(500),
  scored: true,
  status: "settled",
  difficulty: 0.25,
};

function answer(userId = user, option = "yes"): Answer {
  return {
    id: asAnswerId(`answer-${userId}`),
    callId,
    userId,
    option,
    submittedAt: asWallClock(150),
    feedTsAtAnswer: asFeedTimestamp(150),
  };
}

const settlement: Settlement = {
  id: asSettlementId("settlement-1"),
  callId,
  outcome: { status: "settled", winningOption: "yes" },
  settledAtFeedTs: asFeedTimestamp(300),
  decidingMessageIds: [],
};

function receipt(userId = user): Receipt {
  return {
    id: asReceiptId(`receipt-${userId}`),
    fixtureId,
    userId,
    state: "proof-pending",
    subject: { kind: "call", callId, outcome: settlement.outcome },
    createdAt: asWallClock(400),
    updatedAt: asWallClock(400),
  };
}

function artifact(userId = user, option = "yes"): ScoredArtifact {
  const selected = answer(userId, option);
  const score = scoreAnswer(selected, call, settlement);
  assert.ok(score);
  return { answer: selected, call, settlement, score, receipt: receipt(userId) };
}

test("scores only settled scored calls using signed difficulty", () => {
  const correct = scoreAnswer(answer(), call, settlement);
  assert.deepEqual(correct, {
    answerId: asAnswerId("answer-peer-user"),
    callId,
    userId: user,
    correct: true,
    points: 400,
    multiplier: 4,
  });
  assert.equal(scoreAnswer(answer(user, "no"), call, settlement)?.points, 0);
  assert.equal(scoreAnswer(answer(), { ...call, scored: false }, settlement), null);
  assert.equal(scoreAnswer(answer(), call, { ...settlement, outcome: { status: "void", reason: "feed-gap" } }), null);
});

test("receipt validation never promotes incomplete anchor proof", () => {
  assert.equal(verifyReceipt(receipt()), true);
  assert.equal(verifyReceipt({ ...receipt(), state: "anchored" }), false);
  assert.equal(verifyReceipt({
    ...receipt(),
    state: "anchored",
    proof: { statValidationRef: "stat-1", anchorRef: "tx-1", verifiedAt: asWallClock(500) },
  }), true);
  assert.equal(verifyReceipt({ ...receipt(), updatedAt: asWallClock(399) }), false);
});

test("artifact verification recomputes score and binds receipt subject", () => {
  const valid = artifact();
  assert.equal(verifyScoredArtifact(valid), true);
  assert.equal(verifyScoredArtifact({ ...valid, score: { ...valid.score, points: 999 } }), false);
  assert.equal(verifyScoredArtifact({ ...valid, receipt: { ...valid.receipt, userId: other } }), false);
});

test("leaderboards, Fan Reports, and tournament records derive from verified artifacts", () => {
  const mine = artifact(user, "yes");
  const theirs = artifact(other, "no");
  const leaderboard = buildLeaderboard([mine.score, theirs.score], {
    [user]: "Amina",
    [other]: "Kenji",
  });
  assert.deepEqual(leaderboard.map((entry) => [entry.displayName, entry.fanIq]), [["Amina", 400], ["Kenji", 0]]);

  const report = buildFanReport({
    userId: user,
    roomId: asRoomId("room-1"),
    fixtureId,
    artifacts: [mine, theirs],
    roomScores: [mine.score, theirs.score],
    generatedAt: asWallClock(1_000),
  });
  assert.equal(report.fanIq, 400);
  assert.equal(report.rank, 1);
  assert.equal(report.percentile, 100);
  assert.equal(report.bestRead?.callId, callId);

  const record = buildTournamentRecord(
    asRecordId("record-1"),
    user,
    [mine, theirs],
    asWallClock(2_000),
  );
  assert.equal(record.matchesPlayed, 1);
  assert.equal(record.calls.length, 1);
  assert.equal(record.fanIq, 400);
});
