import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { FixtureMachine } from "../src/state/fixture-machine.js";
import { normalizeScore } from "../src/txline/scores.js";
import { ArchivedScoresAdapter, parseArchivedScoresSse } from "../src/replay/archived-scores.js";

const archive = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/18213979-norway-vs-england/scores.historical.sse");

test("replays the genuine Norway-England archive through the production reducer", () => {
  const records = parseArchivedScoresSse(fs.readFileSync(archive, "utf8"));
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine("18213979" as never);
  const events = [];
  for (const record of records) {
    const result = machine.step(normalizeScore(adapter.adapt(record)));
    events.push(...result.events);
  }
  assert.equal(records.length, 1_185);
  assert.deepEqual(machine.snapshot.score, { home: 1, away: 2 });
  assert.equal(machine.snapshot.status, "full-time");
  assert.deepEqual(events.filter((event) => event.kind === "goal").map((event) => event.side), ["home", "away", "away"]);
  assert.equal(events.filter((event) => event.kind === "goal").length, 3);
});
