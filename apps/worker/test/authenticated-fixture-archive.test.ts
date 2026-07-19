import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLogger } from "../src/logger.js";
import { FixturePlanePublisher } from "../src/publisher/fixture-publisher.js";
import {
  AuthenticatedFixtureReplay,
  AuthenticatedFixtureScheduleReplay,
  loadAuthenticatedFixtureArchive,
  loadAuthenticatedScheduledFixture,
} from "../src/replay/authenticated-fixture-archive.js";

const capture = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/17588227-mexico-vs-south-africa");
const canadaCapture = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/17926604-canada-vs-bosnia-herzegovina");
const finalCapture = path.resolve(process.cwd(), "../../data/world-cup-2026/18257739-spain-vs-argentina/archive");
const scheduledCapture = path.resolve(process.cwd(), "../../../resources/fixtures/world-cup-2026/17588400-tunisia-vs-switzerland");

test("authenticated schedule replay publishes the exact 104th fixture without inventing match state", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-authenticated-schedule-"));
  const publisher = new FixturePlanePublisher({ storageDir: storage, log: createLogger("error"), networking: false });
  try {
    const source = await loadAuthenticatedScheduledFixture(scheduledCapture);
    assert.equal(source.fixture.id, "17588400");
    assert.equal(source.fixture.home.name, "Tunisia");
    assert.equal(source.fixture.away.name, "Switzerland");
    const replay = new AuthenticatedFixtureScheduleReplay(source);
    await publisher.open();
    await replay.publishFixture(publisher);
    await publisher.flush();

    assert.equal(replay.complete, true);
    assert.deepEqual(replay.state, {
      fixtureId: "17588400",
      status: "scheduled",
      minute: 0,
      score: { home: 0, away: 0 },
      lastFeedTs: source.fixtureCapturedAt,
      lastMessageId: null,
      gaps: [],
    });
    assert.equal(publisher.settlementCheckpoints().length, 0);
    assert.equal(publisher.openCallCheckpoints().length, 0);
  } finally {
    await publisher.close().catch(() => undefined);
    await fs.rm(storage, { recursive: true, force: true });
  }
});

test("authenticated interval archive publishes canonical facts, deterministic calls, and total settlements", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-authenticated-replay-"));
  const publisher = new FixturePlanePublisher({ storageDir: storage, log: createLogger("error"), networking: false });
  try {
    const source = await loadAuthenticatedFixtureArchive(capture);
    assert.equal(source.scoreFormat, "historical-interval-json");
    assert.equal(source.records.length, 970);
    const replay = new AuthenticatedFixtureReplay(source);
    await publisher.open();
    await replay.finish(publisher);
    await publisher.flush();

    assert.equal(replay.complete, true);
    assert.equal(replay.state.status, "full-time");
    assert.deepEqual(replay.state.score, { home: 2, away: 0 });
    assert.equal(replay.state.gaps.length, 8);
    assert.deepEqual(replay.events.filter((event) => event.kind === "goal").map((event) => event.side), ["home", "home"]);

    const settlements = publisher.settlementCheckpoints();
    assert.equal(settlements.length, 9);
    const settled = settlements.filter((record) => record.settlement.outcome.status === "settled");
    const voided = settlements.filter((record) => record.settlement.outcome.status === "void");
    assert.equal(settled.length, 3);
    assert.equal(voided.length, 6);
    assert.deepEqual(settled.map((record) => record.settlement.outcome), [
      { status: "settled", winningOption: "no" },
      { status: "settled", winningOption: "no" },
      { status: "settled", winningOption: "no" },
    ]);
    assert.equal(publisher.openCallCheckpoints().length, 0);
  } finally {
    await publisher.close().catch(() => undefined);
    await fs.rm(storage, { recursive: true, force: true });
  }
});

test("authenticated replay rejects Canada's regressive post-terminal amendment and signs the finalised state", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-canada-replay-"));
  const publisher = new FixturePlanePublisher({ storageDir: storage, log: createLogger("error"), networking: false });
  try {
    const replay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(canadaCapture));
    await publisher.open();
    await replay.finish(publisher);
    await publisher.flush();
    assert.equal(replay.complete, true);
    assert.equal(replay.state.status, "full-time");
    assert.deepEqual(replay.state.score, { home: 1, away: 1 });
    assert.equal(replay.events.filter((event) => event.kind === "full-time").length, 1);
    assert.equal(replay.events.filter((event) => event.kind === "second-half-start").length, 1);
    assert.equal(publisher.openCallCheckpoints().length, 0);
    assert.equal(publisher.settlementCheckpoints().length, 6);
  } finally {
    await publisher.close().catch(() => undefined);
    await fs.rm(storage, { recursive: true, force: true });
  }
});

test("authenticated final replay preserves extra time, red card, goal, and total call settlements", async () => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-final-replay-"));
  const publisher = new FixturePlanePublisher({ storageDir: storage, log: createLogger("error"), networking: false });
  try {
    const replay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(finalCapture));
    await publisher.open();
    await replay.finish(publisher);
    await publisher.flush();

    assert.equal(replay.complete, true);
    assert.equal(replay.state.status, "full-time");
    assert.deepEqual(replay.state.score, { home: 1, away: 0 });
    assert.equal(replay.events.filter((event) => event.kind === "end-of-regulation").length, 1);
    assert.equal(replay.events.filter((event) => event.kind === "extra-time-start").length, 1);
    assert.deepEqual(replay.events.filter((event) => event.kind === "red-card").map((event) => event.side), ["away"]);
    assert.deepEqual(replay.events.filter((event) => event.kind === "goal").map((event) => [event.side, event.minute]), [["home", 105]]);
    assert.equal(replay.events.filter((event) => event.kind === "full-time").length, 1);

    const settlements = publisher.settlementCheckpoints();
    assert.deepEqual(
      settlements.filter((record) => record.settlement.outcome.status === "settled")
        .map((record) => record.settlement.outcome),
      [
        { status: "settled", winningOption: "no" },
        { status: "settled", winningOption: "no" },
      ],
    );
    assert.equal(publisher.openCallCheckpoints().length, 0);
  } finally {
    await publisher.close().catch(() => undefined);
    await fs.rm(storage, { recursive: true, force: true });
  }
});
