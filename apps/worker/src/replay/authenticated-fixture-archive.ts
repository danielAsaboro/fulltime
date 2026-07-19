import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { asFeedTimestamp, type Fixture, type FixtureState, type MatchEvent } from "@fulltime/shared";

import type { FixturePlanePublisher } from "../publisher/fixture-publisher.js";
import { FixtureMachine } from "../state/fixture-machine.js";
import { normalizeFixture } from "../txline/fixtures.js";
import { normalizeScore } from "../txline/scores.js";
import type { TxFixture } from "../txline/types.js";
import {
  ArchivedScoresAdapter,
  parseArchivedScoresJson,
  parseArchivedScoresSse,
  type ArchivedScoreRecord,
} from "./archived-scores.js";

export interface AuthenticatedFixtureArchiveSource {
  directory: string;
  fixture: Fixture;
  fixtureCapturedAt: number;
  records: ArchivedScoreRecord[];
  scoreFormat: "historical-sse" | "historical-interval-json";
}

export interface AuthenticatedScheduledFixtureSource {
  directory: string;
  fixture: Fixture;
  fixtureCapturedAt: number;
}

export async function loadAuthenticatedScheduledFixture(directory: string): Promise<AuthenticatedScheduledFixtureSource> {
  const absolute = path.resolve(directory);
  const root = path.dirname(absolute);
  const snapshotPath = path.join(root, "fixtures.snapshot.json");
  const provenancePath = `${snapshotPath}.provenance.json`;
  const [snapshotBytes, provenanceBytes, fixtureBytes] = await Promise.all([
    fs.readFile(snapshotPath),
    fs.readFile(provenancePath),
    fs.readFile(path.join(absolute, "fixture.json")),
  ]);
  const provenance = JSON.parse(provenanceBytes.toString("utf8")) as { sha256?: unknown };
  const digest = crypto.createHash("sha256").update(snapshotBytes).digest("hex");
  if (typeof provenance.sha256 !== "string" || provenance.sha256 !== digest) {
    throw new Error(`Authenticated fixture schedule provenance mismatch: ${snapshotPath}`);
  }
  const fixtureWire = JSON.parse(fixtureBytes.toString("utf8")) as TxFixture & { Ts?: number };
  const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as Array<TxFixture & { Ts?: number }>;
  const captured = snapshot.find((candidate) => String(candidate.FixtureId) === String(fixtureWire.FixtureId));
  if (!captured || JSON.stringify(captured) !== JSON.stringify(fixtureWire)) {
    throw new Error(`Scheduled fixture is not an exact record from the authenticated snapshot: ${absolute}`);
  }
  if (!Number.isSafeInteger(fixtureWire.Ts) || fixtureWire.Ts! <= 0) {
    throw new Error(`Authenticated scheduled fixture has no valid feed timestamp: ${absolute}`);
  }
  return {
    directory: absolute,
    fixture: normalizeFixture(fixtureWire),
    fixtureCapturedAt: fixtureWire.Ts!,
  };
}

export class AuthenticatedFixtureScheduleReplay {
  readonly source: AuthenticatedScheduledFixtureSource;
  private fixturePublished = false;

  constructor(source: AuthenticatedScheduledFixtureSource) {
    this.source = source;
  }

  get fixture(): Fixture { return this.source.fixture; }
  get state(): FixtureState { return { fixtureId: this.source.fixture.id, status: "scheduled", minute: 0, score: { home: 0, away: 0 }, lastFeedTs: asFeedTimestamp(this.source.fixtureCapturedAt), lastMessageId: null, gaps: [] }; }
  get complete(): boolean { return true; }

  async publishFixture(publisher: FixturePlanePublisher): Promise<void> {
    if (this.fixturePublished) return;
    await publisher.publishFixture(this.source.fixture, this.source.fixtureCapturedAt);
    this.fixturePublished = true;
  }

  async advanceThrough(publisher: FixturePlanePublisher, sourceTimestamp: number): Promise<number> {
    if (!Number.isSafeInteger(sourceTimestamp) || sourceTimestamp <= 0) throw new TypeError("Schedule replay timestamp is invalid");
    await this.publishFixture(publisher);
    return 0;
  }

  finish(publisher: FixturePlanePublisher): Promise<number> {
    return this.advanceThrough(publisher, Number.MAX_SAFE_INTEGER);
  }
}

export async function loadAuthenticatedFixtureArchive(directory: string): Promise<AuthenticatedFixtureArchiveSource> {
  const absolute = path.resolve(directory);
  const fixtureWire = JSON.parse(await fs.readFile(path.join(absolute, "fixture.json"), "utf8")) as TxFixture & { Ts?: number };
  const fixture = normalizeFixture(fixtureWire);
  if (!Number.isSafeInteger(fixtureWire.Ts) || fixtureWire.Ts! <= 0) {
    throw new Error(`Authenticated fixture archive has no valid capture timestamp: ${absolute}`);
  }
  const scores = await readArchivedScores(absolute);
  const records = scores.records.filter((record) =>
    (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised"
  );
  if (!records.length) throw new Error(`Authenticated fixture archive has no in-match score records: ${absolute}`);
  if (records.some((record) => String(record.FixtureId) !== String(fixture.id))) {
    throw new Error(`Authenticated fixture archive mixes fixture identities: ${absolute}`);
  }
  return {
    directory: absolute,
    fixture,
    fixtureCapturedAt: fixtureWire.Ts!,
    records,
    scoreFormat: scores.format,
  };
}

/**
 * Incrementally feeds parsed authenticated capture records through the production
 * adapter, normalizer, state machine, and signed publisher. The cursor makes it
 * possible to interleave real room operations at their historical timestamps.
 */
export class AuthenticatedFixtureReplay {
  readonly source: AuthenticatedFixtureArchiveSource;
  private readonly adapter = new ArchivedScoresAdapter();
  private readonly machine: FixtureMachine;
  private cursor = 0;
  private fixturePublished = false;
  private readonly emitted: MatchEvent[] = [];

  constructor(source: AuthenticatedFixtureArchiveSource) {
    this.source = source;
    this.machine = new FixtureMachine(source.fixture.id);
  }

  get fixture(): Fixture {
    return this.source.fixture;
  }

  get state(): FixtureState {
    return this.machine.snapshot;
  }

  get events(): MatchEvent[] {
    return this.emitted.map((event) => structuredClone(event));
  }

  get complete(): boolean {
    return this.cursor === this.source.records.length;
  }

  async publishFixture(publisher: FixturePlanePublisher): Promise<void> {
    if (this.fixturePublished) return;
    await publisher.publishFixture(this.source.fixture, this.source.fixtureCapturedAt);
    this.fixturePublished = true;
  }

  async advanceThrough(publisher: FixturePlanePublisher, sourceTimestamp: number): Promise<number> {
    if (!Number.isSafeInteger(sourceTimestamp) || sourceTimestamp <= 0) throw new TypeError("Archive replay timestamp is invalid");
    await this.publishFixture(publisher);
    let published = 0;
    while (this.cursor < this.source.records.length && this.source.records[this.cursor]!.Ts <= sourceTimestamp) {
      const record = this.source.records[this.cursor++]!;
      const normalized = normalizeScore(this.adapter.adapt(record));
      const result = this.machine.step(normalized);
      if (result.duplicate || result.outOfOrder) continue;
      // A capture may contain a late amendment carrying an obsolete live
      // status after full-time. The production fold keeps terminal state
      // sticky; do not sign a contradictory update merely to preserve that
      // regressive source row. A later game_finalised record remains eligible.
      if (result.state.status !== normalized.status) continue;
      await publisher.publishScore({
        fixtureId: normalized.fixtureId,
        feedTs: normalized.feedTs,
        messageId: normalized.messageId,
        seq: normalized.seq,
        statusCode: normalized.statusCode,
        status: normalized.status,
        minute: normalized.minute,
        score: normalized.score,
        hasScore: normalized.hasScore,
      }, result.state, result.events, record.Ts);
      this.emitted.push(...result.events);
      published++;
    }
    return published;
  }

  finish(publisher: FixturePlanePublisher): Promise<number> {
    return this.advanceThrough(publisher, Number.MAX_SAFE_INTEGER);
  }
}

async function readArchivedScores(directory: string): Promise<{
  records: ArchivedScoreRecord[];
  format: AuthenticatedFixtureArchiveSource["scoreFormat"];
}> {
  try {
    const sse = await fs.readFile(path.join(directory, "scores.historical.sse"), "utf8");
    const records = parseArchivedScoresSse(sse);
    if (records.length) return { records, format: "historical-sse" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const json = await fs.readFile(path.join(directory, "scores.historical-intervals.json"), "utf8");
    const records = parseArchivedScoresJson(json);
    if (!records.length) throw new Error(`Authenticated interval capture is empty: ${directory}`);
    return { records, format: "historical-interval-json" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Authenticated fixture archive has neither populated historical SSE nor interval JSON: ${directory}`);
    }
    throw error;
  }
}
