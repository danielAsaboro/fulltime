#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FixturePlanePublisher } from "../apps/worker/src/publisher/fixture-publisher.js";
import {
  AuthenticatedFixtureReplay,
  loadAuthenticatedFixtureArchive,
} from "../apps/worker/src/replay/authenticated-fixture-archive.js";
import { createLogger } from "../apps/worker/src/logger.js";

const captureArg = process.argv[2];
if (!captureArg) {
  throw new Error("Usage: pnpm exec tsx scripts/inspect-authenticated-archive.ts <fixture-capture-directory>");
}

const captureDirectory = path.resolve(process.cwd(), captureArg);
const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fulltime-archive-inspect-"));
const publisher = new FixturePlanePublisher({
  storageDir: storageDirectory,
  networking: false,
  log: createLogger("error"),
});

try {
  await publisher.open();
  const replay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(captureDirectory));
  await replay.finish(publisher);
  await publisher.flush();

  const calls = [];
  for (let index = 0; index < publisher.length; index += 1) {
    const record = await publisher.get(index);
    if (record?.kind === "fixture.call.open") {
      calls.push({
        id: record.call.id,
        prompt: record.call.prompt,
        openedAt: record.call.openedAt,
        locksAt: record.call.locksAt,
        settlesBy: record.call.settlesBy,
        options: record.call.options.map((option) => option.id),
      });
    }
  }

  console.log(JSON.stringify({
    fixture: replay.fixture,
    scoreFormat: replay.source.scoreFormat,
    recordCount: replay.source.records.length,
    finalState: replay.state,
    events: replay.events,
    calls,
    settlements: publisher.settlementCheckpoints().map((record) => record.settlement),
  }, null, 2));
} finally {
  await publisher.close().catch(() => undefined);
  await fs.rm(storageDirectory, { recursive: true, force: true });
}
