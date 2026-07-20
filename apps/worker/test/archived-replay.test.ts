import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { FixtureMachine } from "../src/state/fixture-machine.js";
import { normalizeScore } from "../src/txline/scores.js";
import { ArchivedScoresAdapter, parseArchivedScoresJson, parseArchivedScoresSse } from "../src/replay/archived-scores.js";

const archive = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/18213979-norway-vs-england/scores.historical.sse");
const franceSpainArchive = path.resolve(
  process.cwd(),
  "../../data/world-cup-2026/18237038-france-vs-spain/archive/scores.historical.sse",
);
const spainArgentinaArchive = path.resolve(
  process.cwd(),
  "../../data/world-cup-2026/18257739-spain-vs-argentina/archive/scores.historical.sse",
);

test("replays the genuine Norway-England archive through the production reducer", () => {
  const records = parseArchivedScoresSse(fs.readFileSync(archive, "utf8"));
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine("18213979" as never);
  const events = [];
  for (const record of records.filter((record) =>
    (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised"
  )) {
    const result = machine.step(normalizeScore(adapter.adapt(record)));
    events.push(...result.events);
  }
  assert.equal(records.length, 1_185);
  assert.deepEqual(machine.snapshot.score, { home: 1, away: 2 });
  assert.equal(machine.snapshot.status, "full-time");
  assert.deepEqual(events.filter((event) => event.kind === "goal").map((event) => event.side), ["home", "away", "away"]);
  assert.equal(events.filter((event) => event.kind === "goal").length, 3);
});

test("replays the genuine Mexico-South Africa interval capture through the production reducer", () => {
  const intervalArchive = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/17588227-mexico-vs-south-africa/scores.historical-intervals.json");
  const records = parseArchivedScoresJson(fs.readFileSync(intervalArchive, "utf8"));
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine("17588227" as never);
  const events = [];
  for (const record of records.filter((record) => (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised")) {
    const result = machine.step(normalizeScore(adapter.adapt(record)));
    events.push(...result.events);
  }
  assert.equal(records.length, 994);
  assert.deepEqual(machine.snapshot.score, { home: 2, away: 0 });
  assert.equal(machine.snapshot.status, "full-time");
  assert.deepEqual(events.filter((event) => event.kind === "goal").map((event) => event.side), ["home", "home"]);
  assert.equal(machine.snapshot.gaps.length, 8, "the authenticated interval capture contains eight real sequence gaps");
});

test("keeps Canada-Bosnia terminal after a post-full-time source amendment", () => {
  const intervalArchive = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/17926604-canada-vs-bosnia-herzegovina/scores.historical-intervals.json");
  const records = parseArchivedScoresJson(fs.readFileSync(intervalArchive, "utf8"));
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine("17926604" as never);
  const events = [];
  for (const record of records.filter((record) => (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised")) {
    const result = machine.step(normalizeScore(adapter.adapt(record)));
    events.push(...result.events);
  }
  assert.equal(records.length, 1_119);
  assert.deepEqual(machine.snapshot.score, { home: 1, away: 1 });
  assert.equal(machine.snapshot.status, "full-time");
  assert.equal(events.filter((event) => event.kind === "full-time").length, 1);
  assert.equal(events.filter((event) => event.kind === "second-half-start").length, 1);
  assert.deepEqual(events.filter((event) => event.kind === "goal").map((event) => event.side), ["away", "home"]);
});

test("replays France-Spain penalty and ignores a stale first-half amendment", () => {
  const records = parseArchivedScoresSse(fs.readFileSync(franceSpainArchive, "utf8"));
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine("18237038" as never);
  const events = [];
  for (const record of records.filter((record) =>
    (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised"
  )) {
    const result = machine.step(normalizeScore(adapter.adapt(record)));
    events.push(...result.events);
  }
  assert.equal(records.length, 1_027);
  assert.deepEqual(machine.snapshot.score, { home: 0, away: 2 });
  assert.equal(machine.snapshot.status, "full-time");
  assert.deepEqual(
    events.filter((event) => ["goal", "penalty-scored"].includes(event.kind)).map((event) => [event.kind, event.side]),
    [["penalty-scored", "away"], ["goal", "away"]],
  );
  assert.equal(events.filter((event) => event.kind === "kickoff").length, 1);
  assert.equal(events.filter((event) => event.kind === "second-half-start").length, 1);
});

test("replays Spain-Argentina through regulation, extra time, and signed finalisation", () => {
  const records = parseArchivedScoresSse(fs.readFileSync(spainArgentinaArchive, "utf8"));
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine("18257739" as never);
  const events = [];
  for (const record of records.filter((record) =>
    (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised"
  )) {
    const result = machine.step(normalizeScore(adapter.adapt(record)));
    events.push(...result.events);
  }

  assert.deepEqual(machine.snapshot.score, { home: 1, away: 0 });
  assert.equal(machine.snapshot.status, "full-time");
  assert.deepEqual(
    events.filter((event) => ["end-of-regulation", "extra-time-start", "red-card", "goal", "full-time"].includes(event.kind))
      .map((event) => [event.kind, event.side, event.minute, event.score]),
    [
      ["red-card", "away", 92, { home: 0, away: 0 }],
      ["end-of-regulation", null, null, { home: 0, away: 0 }],
      ["extra-time-start", null, 90, { home: 0, away: 0 }],
      ["goal", "home", 105, { home: 1, away: 0 }],
      ["full-time", null, null, { home: 1, away: 0 }],
    ],
  );
  assert.equal(events.filter((event) => event.kind === "goal").length, 1, "discarded provisional goals stay absent");
});
