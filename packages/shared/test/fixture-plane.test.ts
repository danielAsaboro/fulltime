import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIXTURE_PLANE_VERSION,
  FixturePlaneValidationError,
  asSettlementId,
  asFeedMessageId,
  asFeedTimestamp,
  asFixtureId,
  asMatchEventId,
  asWallClock,
  decodeFixturePlaneRecord,
  encodeFixturePlaneRecord,
  isFixturePlaneRecord,
  parseFixturePlaneRecord,
  callsForEvent,
  evaluateCall,
  type FixtureCallOpenRecord,
  type FixtureCallSettledRecord,
  type FixturePlaneRecord,
  type FixtureScoreRecord,
  type FixtureUpsertRecord,
} from "../src/index";

const fixtureRecord: FixtureUpsertRecord = {
  version: FIXTURE_PLANE_VERSION,
  kind: "fixture.upsert",
  publishedAt: asWallClock(1_800_000_000_000),
  fixture: {
    id: asFixtureId("900001"),
    competition: "World Cup 2026",
    home: { id: "111", name: "France", shortName: "FRA", country: "FR" },
    away: { id: "222", name: "Morocco", shortName: "MAR", country: "MA" },
    kickoff: asFeedTimestamp(1_800_000_100_000),
    status: "scheduled",
  },
};

const scoreRecord: FixtureScoreRecord = {
  version: FIXTURE_PLANE_VERSION,
  kind: "fixture.score",
  publishedAt: asWallClock(1_800_000_200_001),
  update: {
    fixtureId: asFixtureId("900001"),
    feedTs: asFeedTimestamp(1_800_000_200_000),
    messageId: asFeedMessageId("900001:7"),
    seq: 7,
    statusCode: 2,
    status: "first-half",
    minute: 23,
    score: { home: 1, away: 0 },
    hasScore: true,
  },
  state: {
    fixtureId: asFixtureId("900001"),
    status: "first-half",
    minute: 23,
    score: { home: 1, away: 0 },
    lastFeedTs: asFeedTimestamp(1_800_000_200_000),
    lastMessageId: asFeedMessageId("900001:7"),
    gaps: [],
  },
  events: [
    {
      id: asMatchEventId("900001:7:goal"),
      fixtureId: asFixtureId("900001"),
      kind: "goal",
      feedTs: asFeedTimestamp(1_800_000_200_000),
      messageId: asFeedMessageId("900001:7"),
      minute: 23,
      side: "home",
      score: { home: 1, away: 0 },
    },
  ],
};

test("fixture-plane records round-trip through strict UTF-8 JSON validation", () => {
  for (const source of [fixtureRecord, scoreRecord] satisfies FixturePlaneRecord[]) {
    const decoded = decodeFixturePlaneRecord(encodeFixturePlaneRecord(source));
    assert.deepEqual(decoded, source);
    assert.equal(isFixturePlaneRecord(decoded), true);
  }
});

test("fixture-plane score records bind state and events to the update", () => {
  const wrongState = structuredClone(scoreRecord) as unknown as Record<string, unknown>;
  (wrongState.state as Record<string, unknown>).fixtureId = "another-fixture";
  assert.throws(() => parseFixturePlaneRecord(wrongState), FixturePlaneValidationError);

  const wrongEvent = structuredClone(scoreRecord) as unknown as Record<string, unknown>;
  const events = wrongEvent.events as Array<Record<string, unknown>>;
  events[0]!.messageId = "900001:8";
  assert.throws(() => parseFixturePlaneRecord(wrongEvent), /events\.messageId must match/);
});

test("fixture-plane validation rejects unknown fields, schema versions, and malformed blocks", () => {
  assert.throws(
    () => parseFixturePlaneRecord({ ...fixtureRecord, unsignedClaim: true }),
    /unsupported field|must contain exactly/,
  );
  assert.throws(() => parseFixturePlaneRecord({ ...fixtureRecord, version: 2 }), /version is unsupported/);
  assert.throws(() => decodeFixturePlaneRecord(Uint8Array.from([0xff, 0xfe, 0xfd])), /valid UTF-8 JSON/);
  assert.equal(isFixturePlaneRecord(null), false);
});

test("fixture-plane odds records accept only complete positive 1X2 decimals", () => {
  const odds: FixturePlaneRecord = {
    version: FIXTURE_PLANE_VERSION,
    kind: "fixture.odds",
    publishedAt: asWallClock(1_800_000_300_001),
    odds: {
      fixtureId: asFixtureId("900001"),
      feedTs: asFeedTimestamp(1_800_000_300_000),
      messageId: asFeedMessageId("odds-1"),
      decimal: { home: 2, draw: 3.5, away: 4.2 },
    },
  };
  assert.deepEqual(parseFixturePlaneRecord(odds), odds);

  const invalid = structuredClone(odds) as unknown as Record<string, unknown>;
  const decodedOdds = invalid.odds as Record<string, unknown>;
  (decodedOdds.decimal as Record<string, unknown>).draw = 0;
  assert.throws(() => parseFixturePlaneRecord(invalid), /positive finite number/);
});

test("fixture-plane call records round-trip with strict match-wide and total settlement validation", () => {
  const sourceEvent = scoreRecord.events[0]!;
  const scheduled = callsForEvent(sourceEvent)[0]!;
  const opened: FixtureCallOpenRecord = {
    version: FIXTURE_PLANE_VERSION,
    kind: "call.open",
    publishedAt: asWallClock(1_800_000_200_001),
    call: scheduled,
  };
  const decision = evaluateCall(scheduled, {
    events: [sourceEvent],
    gaps: [],
    fixtureStatus: "first-half",
    frontierFeedTs: scheduled.settlesBy,
    fixtureMinute: 33,
  });
  assert.equal(decision.status, "decided");
  if (decision.status !== "decided") return;
  const settled: FixtureCallSettledRecord = {
    version: FIXTURE_PLANE_VERSION,
    kind: "call.settled",
    publishedAt: asWallClock(1_800_000_800_001),
    fixtureId: scheduled.fixtureId,
    settlement: decision.settlement,
  };

  for (const source of [opened, settled] satisfies FixturePlaneRecord[]) {
    assert.deepEqual(decodeFixturePlaneRecord(encodeFixturePlaneRecord(source)), source);
  }

  const roomScoped = structuredClone(opened) as unknown as Record<string, unknown>;
  (roomScoped.call as Record<string, unknown>).roomId = "room:unsigned";
  assert.throws(() => parseFixturePlaneRecord(roomScoped), /roomId must be null/);

  const wrongTemplate = structuredClone(opened) as unknown as Record<string, unknown>;
  (wrongTemplate.call as Record<string, unknown>).template = "threshold";
  assert.throws(() => parseFixturePlaneRecord(wrongTemplate), /template must match/);

  const partial = structuredClone(settled) as unknown as Record<string, unknown>;
  const settlement = partial.settlement as Record<string, unknown>;
  settlement.id = asSettlementId("settlement:different-call");
  assert.throws(() => parseFixturePlaneRecord(partial), /must be derived from callId/);

  const extra = structuredClone(opened) as unknown as Record<string, unknown>;
  (extra.call as Record<string, unknown>).sourceEventId = sourceEvent.id;
  assert.throws(() => parseFixturePlaneRecord(extra), /unsupported field/);
});
