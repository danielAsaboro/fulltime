import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeScore } from "../src/txline/scores.js";
import { normalizeOdds } from "../src/txline/odds.js";
import { FixtureMachine } from "../src/state/fixture-machine.js";
import type { TxScores } from "../src/txline/types.js";
import type { OddsPayload } from "../src/txline/types.js";

function scores(partial: Partial<TxScores> & Pick<TxScores, "seq" | "ts">): TxScores {
  return {
    fixtureId: 900_001,
    gameState: "",
    startTime: 0,
    competitionId: 0,
    countryId: 0,
    sportId: 0,
    participant1IsHome: true,
    participant1Id: 111,
    participant2Id: 222,
    action: "update",
    id: partial.seq,
    connectionId: 1,
    ...partial,
  };
}

test("normalizeScore maps a home goal and its scoreline", () => {
  const norm = normalizeScore(
    scores({
      seq: 3,
      ts: 1000,
      dataSoccer: { StatusId: 2, Minutes: 23, Goal: true, Participant: 1 },
      scoreSoccer: {
        Participant1: { Total: { Goals: 1, YellowCards: 0, RedCards: 0, Corners: 0 } },
        Participant2: { Total: { Goals: 0, YellowCards: 0, RedCards: 0, Corners: 0 } },
      },
    }),
  );
  assert.equal(norm.incidents.length, 1);
  assert.equal(norm.incidents[0]?.kind, "goal");
  assert.equal(norm.incidents[0]?.side, "home");
  assert.deepEqual(norm.score, { home: 1, away: 0 });
  assert.equal(norm.hasScore, true);
});

test("normalizeScore reads a penalty goal for the away side", () => {
  const norm = normalizeScore(
    scores({
      seq: 5,
      ts: 2000,
      dataSoccer: { StatusId: 4, Minutes: 82, Goal: true, Penalty: true, Participant: 2 },
    }),
  );
  assert.equal(norm.incidents[0]?.kind, "penalty-scored");
  assert.equal(norm.incidents[0]?.side, "away");
  assert.equal(norm.hasScore, false);
});

test("FixtureMachine emits kickoff then a goal, tracking the score", () => {
  const m = new FixtureMachine("900001" as never);
  const kickoff = m.step(normalizeScore(scores({ seq: 1, ts: 100, dataSoccer: { StatusId: 2, Minutes: 0 } })));
  assert.equal(kickoff.events[0]?.kind, "kickoff");

  const goal = m.step(
    normalizeScore(
      scores({
        seq: 2,
        ts: 200,
        dataSoccer: { StatusId: 2, Minutes: 23, Goal: true, Participant: 1 },
        scoreSoccer: {
          Participant1: { Total: { Goals: 1, YellowCards: 0, RedCards: 0, Corners: 0 } },
          Participant2: { Total: { Goals: 0, YellowCards: 0, RedCards: 0, Corners: 0 } },
        },
      }),
    ),
  );
  assert.equal(goal.events.some((e) => e.kind === "goal"), true);
  assert.deepEqual(m.snapshot.score, { home: 1, away: 0 });
  assert.equal(m.snapshot.status, "first-half");
});

test("FixtureMachine is idempotent on a repeated seq and rejects out-of-order", () => {
  const m = new FixtureMachine("900001" as never);
  m.step(normalizeScore(scores({ seq: 5, ts: 500, dataSoccer: { StatusId: 2, Minutes: 10 } })));
  const dupe = m.step(normalizeScore(scores({ seq: 5, ts: 500, dataSoccer: { StatusId: 2, Minutes: 10 } })));
  assert.equal(dupe.duplicate, true);
  assert.equal(dupe.events.length, 0);

  const stale = m.step(normalizeScore(scores({ seq: 4, ts: 400, dataSoccer: { StatusId: 2, Minutes: 9 } })));
  assert.equal(stale.outOfOrder, true);
});

test("FixtureMachine records a feed gap when the sequence jumps", () => {
  const m = new FixtureMachine("900001" as never);
  m.step(normalizeScore(scores({ seq: 1, ts: 100, dataSoccer: { StatusId: 2, Minutes: 1 } })));
  const jumped = m.step(normalizeScore(scores({ seq: 4, ts: 400, dataSoccer: { StatusId: 2, Minutes: 4 } })));
  assert.ok(jumped.gap);
  assert.equal(m.snapshot.gaps.length, 1);
});

test("a status-only update does not clobber the scoreline", () => {
  const m = new FixtureMachine("900001" as never);
  m.step(
    normalizeScore(
      scores({
        seq: 1,
        ts: 100,
        dataSoccer: { StatusId: 2, Minutes: 23, Goal: true, Participant: 1 },
        scoreSoccer: {
          Participant1: { Total: { Goals: 1, YellowCards: 0, RedCards: 0, Corners: 0 } },
          Participant2: { Total: { Goals: 0, YellowCards: 0, RedCards: 0, Corners: 0 } },
        },
      }),
    ),
  );
  m.step(normalizeScore(scores({ seq: 2, ts: 200, dataSoccer: { StatusId: 3, Minutes: 45 } })));
  assert.deepEqual(m.snapshot.score, { home: 1, away: 0 });
  assert.equal(m.snapshot.status, "half-time");
});

function odds(partial: Partial<OddsPayload>): OddsPayload {
  return {
    FixtureId: 900_001,
    MessageId: "m1",
    Ts: 1000,
    Bookmaker: "x",
    BookmakerId: 1,
    SuperOddsType: "1X2",
    InRunning: true,
    ...partial,
  };
}

test("normalizeOdds reads de-vigged 1X2 percentages into decimals", () => {
  const snap = normalizeOdds(odds({ PriceNames: ["1", "X", "2"], Pct: ["50.000", "25.000", "25.000"] }));
  assert.ok(snap);
  assert.equal(snap.decimal.home, 2);
  assert.equal(snap.decimal.draw, 4);
  assert.equal(snap.decimal.away, 4);
});

test("normalizeOdds skips a market with an NA leg or unknown outcomes", () => {
  assert.equal(normalizeOdds(odds({ PriceNames: ["1", "X", "2"], Pct: ["50.000", "NA", "25.000"] })), null);
  assert.equal(normalizeOdds(odds({ PriceNames: ["Over", "Under"], Pct: ["50.000", "50.000"] })), null);
});
