import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FIXTURE_PLANE_VERSION,
  asFeedMessageId,
  asFeedTimestamp,
  asFixtureId,
  asMatchEventId,
  asWallClock,
  encodeFixturePlaneRecord,
  type FixtureCallOpenRecord,
  type FixtureCallSettledRecord,
  type Fixture,
  type FixtureScoreRecord,
  type FixtureState,
  type MatchEvent,
  type PublishedScoreUpdate,
} from "@fulltime/shared";

import type { Logger } from "../src/logger.js";
import { FixturePlanePublisher } from "../src/publisher/fixture-publisher.js";

const require = createRequire(import.meta.url);
const Corestore = require("corestore") as new (storage: string) => {
  ready(): Promise<void>;
  get(options: { name: string }): {
    ready(): Promise<void>;
    append(value: Uint8Array): Promise<unknown>;
  };
  close(): Promise<void>;
};

const quiet: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const fixture: Fixture = {
  id: asFixtureId("900001"),
  competition: "World Cup 2026",
  home: { id: "111", name: "France" },
  away: { id: "222", name: "Morocco" },
  kickoff: asFeedTimestamp(1_800_000_000_000),
  status: "scheduled",
};

const update: PublishedScoreUpdate = {
  fixtureId: fixture.id,
  feedTs: asFeedTimestamp(1_800_000_060_000),
  messageId: asFeedMessageId("900001:1"),
  seq: 1,
  statusCode: 2,
  status: "first-half",
  minute: 1,
  score: { home: 0, away: 0 },
  hasScore: true,
};

const state: FixtureState = {
  fixtureId: fixture.id,
  status: "first-half",
  minute: 1,
  score: { home: 0, away: 0 },
  lastFeedTs: update.feedTs,
  lastMessageId: update.messageId,
  gaps: [],
};

test("fixture publisher persists one signed writer and deduplicates immutable feed IDs", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-fixture-plane-"));
  let publisher: FixturePlanePublisher | null = new FixturePlanePublisher({
    storageDir,
    log: quiet,
    networking: false,
  });

  try {
    const firstDescriptor = await publisher.open();
    assert.match(firstDescriptor.key, /^[a-f0-9]{64}$/);
    assert.match(firstDescriptor.discoveryKey, /^[a-f0-9]{64}$/);
    assert.notEqual(firstDescriptor.key, firstDescriptor.discoveryKey);

    assert.deepEqual(await publisher.publishFixture(fixture, 1_800_000_000_001), {
      appended: true,
      index: 0,
    });
    assert.deepEqual(await publisher.publishFixture(fixture, 1_800_000_000_999), {
      appended: false,
      index: 0,
    });

    assert.deepEqual(await publisher.publishScore(update, state, [], 1_800_000_060_001), {
      appended: true,
      index: 1,
    });
    assert.deepEqual(await publisher.publishScore(update, state, [], 1_800_000_060_999), {
      appended: false,
      index: 1,
    });

    const conflictingState: FixtureState = { ...state, minute: 2 };
    await assert.rejects(
      publisher.publishScore(update, conflictingState, [], 1_800_000_061_000),
      /Conflicting fixture-plane record/,
    );

    assert.deepEqual(
      await publisher.publishOdds(
        {
          fixtureId: fixture.id,
          feedTs: asFeedTimestamp(1_800_000_062_000),
          messageId: asFeedMessageId("odds-1"),
          decimal: { home: 2, draw: 3.5, away: 4.2 },
        },
        1_800_000_062_001,
      ),
      { appended: true, index: 2 },
    );
    assert.equal(publisher.length, 3);
    assert.equal((await publisher.get(1))?.kind, "fixture.score");

    await publisher.close();
    publisher = null;

    const reopened = new FixturePlanePublisher({ storageDir, log: quiet, networking: false });
    publisher = reopened;
    const secondDescriptor = await reopened.open();
    assert.equal(secondDescriptor.key, firstDescriptor.key);
    assert.equal(reopened.length, 3);
    assert.equal(reopened.scoreCheckpoints().length, 1);
    assert.equal(reopened.scoreCheckpoints()[0]?.update.seq, 1);
    assert.deepEqual(await reopened.get(0), {
      version: 1,
      kind: "fixture.upsert",
      publishedAt: 1_800_000_000_001,
      fixture,
    });
    assert.deepEqual(await reopened.publishFixture(fixture), { appended: false, index: 0 });
  } finally {
    await publisher?.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test("fixture publisher allows a real schedule correction as a later upsert", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-fixture-upsert-"));
  const publisher = new FixturePlanePublisher({ storageDir, log: quiet, networking: false });
  try {
    await publisher.open();
    await publisher.publishFixture(fixture, 1_800_000_000_001);
    const corrected = {
      ...fixture,
      kickoff: asFeedTimestamp(Number(fixture.kickoff) + 30 * 60_000),
    };
    assert.deepEqual(await publisher.publishFixture(corrected, 1_800_000_000_002), {
      appended: true,
      index: 1,
    });
    assert.equal(publisher.length, 2);
  } finally {
    await publisher.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test("fixture publisher derives calls and total settlements from signed score and odds frontiers", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-call-plane-"));
  let publisher: FixturePlanePublisher | null = new FixturePlanePublisher({
    storageDir,
    log: quiet,
    networking: false,
  });
  const kickoffTs = asFeedTimestamp(1_800_000_000_000);
  const kickoffUpdate: PublishedScoreUpdate = {
    ...update,
    feedTs: kickoffTs,
    messageId: asFeedMessageId("900001:kickoff"),
    seq: 1,
    minute: 0,
  };
  const kickoffState: FixtureState = {
    ...state,
    minute: 0,
    lastFeedTs: kickoffTs,
    lastMessageId: kickoffUpdate.messageId,
  };
  const kickoff: MatchEvent = {
    id: asMatchEventId("900001:kickoff:phase:kickoff"),
    fixtureId: fixture.id,
    kind: "kickoff",
    feedTs: kickoffTs,
    messageId: kickoffUpdate.messageId,
    minute: 0,
    side: null,
    score: { home: 0, away: 0 },
  };

  try {
    await publisher.open();
    assert.deepEqual(
      await publisher.publishScore(kickoffUpdate, kickoffState, [kickoff], 1_800_000_000_001),
      { appended: true, index: 0 },
    );
    assert.equal(publisher.length, 3, "one score plus two deterministic kickoff calls");
    assert.equal(publisher.openCallCheckpoints().length, 2);

    const firstCall = await publisher.get(1);
    assert.equal(firstCall?.kind, "call.open");
    if (!firstCall || firstCall.kind !== "call.open") return;
    assert.deepEqual(
      await publisher.publish({ ...firstCall, publishedAt: 1_800_000_000_999 as typeof firstCall.publishedAt }),
      { appended: false, index: 1 },
    );
    const conflictingCall: FixtureCallOpenRecord = {
      ...firstCall,
      publishedAt: 1_800_000_001_000 as typeof firstCall.publishedAt,
      call: { ...firstCall.call, prompt: `${firstCall.call.prompt} changed` },
    };
    await assert.rejects(publisher.publish(conflictingCall), /Conflicting fixture-plane record/);

    const oddsTs = asFeedTimestamp(Number(kickoffTs) + 11 * 60_000);
    await publisher.publishOdds(
      {
        fixtureId: fixture.id,
        feedTs: oddsTs,
        messageId: asFeedMessageId("odds:11m"),
        decimal: { home: 2.1, draw: 3.2, away: 3.7 },
      },
      1_800_000_660_001,
    );
    assert.equal(publisher.length, 5, "odds advances the frontier and appends the 10-minute decision");
    assert.equal(publisher.openCallCheckpoints().length, 1);
    assert.equal(publisher.settlementCheckpoints().length, 1);
    assert.deepEqual(publisher.settlementCheckpoints()[0]?.settlement.outcome, {
      status: "settled",
      winningOption: "no",
    });

    const settlementBlock = await publisher.get(4);
    assert.equal(settlementBlock?.kind, "call.settled");
    if (!settlementBlock || settlementBlock.kind !== "call.settled") return;
    assert.deepEqual(
      await publisher.publish({
        ...settlementBlock,
        publishedAt: 1_800_000_660_999 as typeof settlementBlock.publishedAt,
      }),
      { appended: false, index: 4 },
    );
    const conflictingSettlement: FixtureCallSettledRecord = {
      ...settlementBlock,
      publishedAt: 1_800_000_661_000 as typeof settlementBlock.publishedAt,
      settlement: {
        ...settlementBlock.settlement,
        outcome: { status: "settled", winningOption: "yes" },
        settledAtFeedTs: oddsTs,
      },
    };
    await assert.rejects(
      publisher.publish(conflictingSettlement),
      /Conflicting fixture-plane record/,
    );

    await publisher.close();
    publisher = null;

    const reopened = new FixturePlanePublisher({ storageDir, log: quiet, networking: false });
    publisher = reopened;
    await reopened.open();
    assert.equal(reopened.scoreCheckpoints()[0]?.update.seq, 1);
    assert.deepEqual(reopened.eventCheckpoints(String(fixture.id)), [kickoff]);
    assert.equal(reopened.oddsCheckpoints(String(fixture.id)).length, 1);
    assert.equal(reopened.openCallCheckpoints().length, 1);
    assert.equal(reopened.settlementCheckpoints().length, 1);
    assert.equal(reopened.length, 5);

    const goalTs = asFeedTimestamp(Number(kickoffTs) + 20 * 60_000);
    const goalUpdate: PublishedScoreUpdate = {
      ...kickoffUpdate,
      feedTs: goalTs,
      messageId: asFeedMessageId("900001:goal:20"),
      seq: 2,
      minute: 20,
      score: { home: 1, away: 0 },
    };
    const goalState: FixtureState = {
      ...kickoffState,
      minute: 20,
      score: { home: 1, away: 0 },
      lastFeedTs: goalTs,
      lastMessageId: goalUpdate.messageId,
    };
    const goal: MatchEvent = {
      id: asMatchEventId("900001:goal:20:event"),
      fixtureId: fixture.id,
      kind: "goal",
      feedTs: goalTs,
      messageId: goalUpdate.messageId,
      minute: 20,
      side: "home",
      score: { home: 1, away: 0 },
    };
    assert.deepEqual(
      await reopened.publishScore(goalUpdate, goalState, [goal], 1_800_001_200_001),
      { appended: true, index: 5 },
    );
    assert.equal(reopened.length, 8, "score, another-goal call, and first-goal settlement append");
    assert.equal(reopened.openCallCheckpoints().length, 1);
    assert.equal(reopened.settlementCheckpoints().length, 2);
    const firstGoal = reopened.settlementCheckpoints().find((record) =>
      String(record.settlement.callId).includes("first-goal"),
    );
    assert.deepEqual(firstGoal?.settlement.outcome, { status: "settled", winningOption: "home" });
    assert.deepEqual(firstGoal?.settlement.decidingMessageIds, [goalUpdate.messageId]);

    assert.deepEqual(
      await reopened.publishScore(goalUpdate, goalState, [goal], 1_800_001_200_999),
      { appended: false, index: 5 },
    );
    assert.equal(reopened.length, 8, "replayed signed facts and all derived records dedupe");
  } finally {
    await publisher?.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test("publisher rejects fabricated calls and settlements outside canonical signed state", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-call-reject-"));
  const publisher = new FixturePlanePublisher({ storageDir, log: quiet, networking: false });
  try {
    await publisher.open();
    const call: FixtureCallOpenRecord = {
      version: FIXTURE_PLANE_VERSION,
      kind: "call.open",
      publishedAt: 1_800_000_000_001 as FixtureCallOpenRecord["publishedAt"],
      call: {
        id: "call:fabricated" as FixtureCallOpenRecord["call"]["id"],
        fixtureId: fixture.id,
        roomId: null,
        template: "window",
        spec: { kind: "window", event: "goal", withinMinutes: 10 },
        prompt: "Fabricated?",
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        openedAt: asFeedTimestamp(1_800_000_000_000),
        locksAt: asFeedTimestamp(1_800_000_030_000),
        settlesBy: asFeedTimestamp(1_800_000_600_000),
        scored: true,
        status: "open",
      },
    };
    await assert.rejects(publisher.publish(call), /not emitted by a canonical signed event/);

    const settlement: FixtureCallSettledRecord = {
      version: FIXTURE_PLANE_VERSION,
      kind: "call.settled",
      publishedAt: call.publishedAt,
      fixtureId: fixture.id,
      settlement: {
        id: "settlement:call:fabricated" as FixtureCallSettledRecord["settlement"]["id"],
        callId: call.call.id,
        outcome: { status: "void", reason: "unresolved-window" },
        settledAtFeedTs: null,
        decidingMessageIds: [],
      },
    };
    await assert.rejects(publisher.publish(settlement), /unopened call/);
    assert.equal(publisher.length, 0);
  } finally {
    await publisher.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test("publisher repairs derived calls after a restart at a partially appended signed update", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-call-repair-"));
  const rawStore = new Corestore(storageDir);
  const feedTs = asFeedTimestamp(1_800_000_000_000);
  const messageId = asFeedMessageId("900001:partial-kickoff");
  const partialScore = {
    version: FIXTURE_PLANE_VERSION,
    kind: "fixture.score",
    publishedAt: asWallClock(1_800_000_000_001),
    update: {
      ...update,
      feedTs,
      messageId,
      seq: 1,
      minute: 0,
    },
    state: {
      ...state,
      minute: 0,
      lastFeedTs: feedTs,
      lastMessageId: messageId,
    },
    events: [{
      id: asMatchEventId("900001:partial-kickoff:phase:kickoff"),
      fixtureId: fixture.id,
      kind: "kickoff" as const,
      feedTs,
      messageId,
      minute: 0,
      side: null,
      score: { home: 0, away: 0 },
    }],
  } satisfies FixtureScoreRecord;

  try {
    await rawStore.ready();
    const rawCore = rawStore.get({ name: "fulltime-public-fixture-plane-v1" });
    await rawCore.ready();
    await rawCore.append(encodeFixturePlaneRecord(partialScore));
    await rawStore.close();

    const publisher = new FixturePlanePublisher({ storageDir, log: quiet, networking: false });
    try {
      await publisher.open();
      assert.equal(publisher.length, 3, "startup derives both missing kickoff calls from the signed event");
      assert.equal(publisher.openCallCheckpoints().length, 2);
      assert.equal(publisher.eventCheckpoints(String(fixture.id)).length, 1);
      assert.equal(publisher.scoreCheckpoints()[0]?.update.messageId, messageId);
    } finally {
      await publisher.close();
    }
  } finally {
    await rawStore.close().catch(() => undefined);
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});
