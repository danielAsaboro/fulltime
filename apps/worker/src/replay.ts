import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { normalizeFixture } from "./txline/fixtures.js";
import { normalizeScore } from "./txline/scores.js";
import { FixtureMachine } from "./state/fixture-machine.js";
import { FixturePlanePublisher } from "./publisher/fixture-publisher.js";
import { createLogger } from "./logger.js";
import {
  createSignedNetworkManifest,
  loadManifestSigningKey,
  manifestVerificationPublicKey,
  startNetworkManifestService,
} from "./network-manifest.js";
import { ArchivedScoresAdapter, parseArchivedScoresJson, parseArchivedScoresSse, type ArchivedScoreRecord } from "./replay/archived-scores.js";
import type { TxFixture } from "./txline/types.js";

const delaySeconds = positiveNumber(process.env.FULLTIME_REPLAY_START_DELAY_SECONDS ?? "45", "FULLTIME_REPLAY_START_DELAY_SECONDS");
const durationSeconds = positiveNumber(process.env.FULLTIME_REPLAY_DURATION_SECONDS ?? "240", "FULLTIME_REPLAY_DURATION_SECONDS");
const autostart = process.env.FULLTIME_REPLAY_AUTOSTART === "true";
const archiveDir = requiredPath("FULLTIME_REPLAY_ARCHIVE_DIR");
const storageDir = requiredPath("FULLTIME_REPLAY_FIXTURE_PLANE_DIR");
const runtimePath = requiredPath("FULLTIME_REPLAY_RUNTIME_PATH");
const manifestPath = process.env.FULLTIME_MANIFEST_PATH ?? "/v1/network.json";
const manifestHost = process.env.FULLTIME_MANIFEST_HOST ?? "127.0.0.1";
const manifestPort = positiveInteger(process.env.FULLTIME_MANIFEST_PORT ?? "58432", "FULLTIME_MANIFEST_PORT");
const manifestUrl = `https://${manifestHost}:${manifestPort}${manifestPath}`;
const log = createLogger("info");
const controller = new AbortController();

async function main(): Promise<void> {
  const [fixtureSource, archivedScores, signingKey] = await Promise.all([
    fsPromises.readFile(path.join(archiveDir, "fixture.json"), "utf8"),
    loadArchivedScores(archiveDir),
    loadManifestSigningKey(requiredPath("FULLTIME_MANIFEST_SIGNING_KEY_PATH")),
  ]);
  const fixtureWire = JSON.parse(fixtureSource) as TxFixture;
  const fixture = normalizeFixture(fixtureWire);
  const records = archivedScores.records;
  const matchRecords = records.filter((record) =>
    (record.StatusId !== undefined && record.StatusId >= 2) || record.Action === "game_finalised"
  );
  if (!matchRecords.length) throw new Error("Replay archive has no in-match TxLINE records");

  const publisher = new FixturePlanePublisher({ storageDir, log });
  const descriptor = await publisher.open();
  const manifest = createSignedNetworkManifest({ fixtureFeedKey: descriptor.key }, signingKey);
  const manifestService = await startNetworkManifestService({
    manifest,
    host: manifestHost,
    port: manifestPort,
    pathname: manifestPath,
    tlsCertificatePath: requiredPath("FULLTIME_MANIFEST_TLS_CERT_PATH"),
    tlsPrivateKeyPath: requiredPath("FULLTIME_MANIFEST_TLS_KEY_PATH"),
  });
  await publisher.publishFixture(fixture);
  writeRuntime({
    version: 2,
    kind: "txline-replay",
    pid: process.pid,
    endpoint: manifestUrl,
    publicKey: manifestVerificationPublicKey(signingKey),
    caCertificatePath: requiredPath("FULLTIME_MANIFEST_TLS_CERT_PATH"),
    fixtureId: String(fixture.id),
    archiveDir,
    delaySeconds,
    durationSeconds,
    armed: !autostart,
    startedAt: Date.now(),
  });
  log.info("Authenticated TxLINE replay ready", { fixtureId: fixture.id, records: matchRecords.length, archiveFormat: archivedScores.format, delaySeconds, durationSeconds, armed: !autostart, manifest: manifestService.url });

  const close = async (): Promise<void> => {
    controller.abort();
    await publisher.close();
    await manifestService.close();
    try { fs.unlinkSync(runtimePath); } catch {}
  };
  process.once("SIGINT", () => { void close(); });
  process.once("SIGTERM", () => { void close(); });

  if (autostart) await wait(delaySeconds * 1_000, controller.signal);
  else await waitForStart(controller.signal);
  const adapter = new ArchivedScoresAdapter();
  const machine = new FixtureMachine(fixture.id);
  const firstTimestamp = matchRecords[0]!.Ts;
  const lastTimestamp = matchRecords.at(-1)!.Ts;
  const replayStartedAt = Date.now();
  for (const record of matchRecords) {
    const progress = lastTimestamp === firstTimestamp ? 1 : (record.Ts - firstTimestamp) / (lastTimestamp - firstTimestamp);
    await waitUntil(replayStartedAt + progress * durationSeconds * 1_000, controller.signal);
    const normalized = normalizeScore(adapter.adapt(record));
    const result = machine.step(normalized);
    if (result.duplicate || result.outOfOrder) continue;
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
    }, result.state, result.events, Date.now());
    for (const event of result.events) log.info("Replay event", { kind: event.kind, minute: event.minute, score: result.state.score, sourceSeq: record.Seq, sourceTs: record.Ts });
  }
  await publisher.flush();
  log.info("Authenticated TxLINE replay reached terminal state", { fixtureId: fixture.id, score: machine.snapshot.score, sourceFeedTs: machine.snapshot.lastFeedTs });
  await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
}

async function loadArchivedScores(directory: string): Promise<{ records: ArchivedScoreRecord[]; format: "historical-sse" | "historical-interval-json" }> {
  const ssePath = path.join(directory, "scores.historical.sse");
  try {
    const source = await fsPromises.readFile(ssePath, "utf8");
    const records = parseArchivedScoresSse(source);
    if (records.length) return { records, format: "historical-sse" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const intervalPath = path.join(directory, "scores.historical-intervals.json");
  try {
    const records = parseArchivedScoresJson(await fsPromises.readFile(intervalPath, "utf8"));
    if (!records.length) throw new Error(`Archived TxLINE interval capture is empty: ${intervalPath}`);
    return { records, format: "historical-interval-json" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Replay archive has neither a populated scores.historical.sse nor scores.historical-intervals.json: ${directory}`);
    }
    throw error;
  }
}

function requiredPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${name} must be a valid port`);
  return parsed;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Replay stopped"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Replay stopped")); }, { once: true });
  });
}

function waitUntil(timestamp: number, signal: AbortSignal): Promise<void> {
  return wait(Math.max(0, timestamp - Date.now()), signal);
}

function waitForStart(signal: AbortSignal): Promise<void> {
  log.info("Replay armed; send SIGUSR1 with npm run operator:replay:start");
  return new Promise((resolve, reject) => {
    const start = (): void => { signal.removeEventListener("abort", stop); resolve(); };
    const stop = (): void => { process.removeListener("SIGUSR1", start); reject(new Error("Replay stopped")); };
    process.once("SIGUSR1", start);
    signal.addEventListener("abort", stop, { once: true });
  });
}

function writeRuntime(value: object): void {
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true, mode: 0o700 });
  const temporary = `${runtimePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, runtimePath);
}

main().catch((error: unknown) => {
  if (!controller.signal.aborted) console.error(error);
  process.exitCode = controller.signal.aborted ? 0 : 1;
});
