/**
 * FullTime worker entry — the TxLINE spine.
 *
 * Live mode: guest JWT → (fast-path token, or on-chain-backed activation) →
 * fixtures snapshot → scores + odds SSE → seq-ordered fixture state machines →
 * corpus recorder. Feed time is authoritative throughout.
 *
 *   npm run worker             live ingest + record
 *   npm run worker -- --demo   offline: replay a synthetic feed through the recorder
 */

import {
  describeConfig,
  loadConfig,
  streamingBlockers,
  type WorkerConfig,
} from "./config.js";
import { runDemo } from "./demo.js";
import { startOddsIngest, startScoresIngest } from "./ingest.js";
import { createLogger, type Logger } from "./logger.js";
import { CorpusRecorder } from "./recorder/recorder.js";
import { activateWithKeypair } from "./txline/activation.js";
import { TxlineAuth } from "./txline/auth.js";
import { findFixtureByTeams, loadFixtures } from "./txline/fixtures.js";
import { TxlineHttp } from "./txline/http.js";

async function runLive(config: WorkerConfig, log: Logger): Promise<void> {
  const blockers = streamingBlockers(config);
  if (blockers.length > 0) {
    log.warn("Cannot open TxLINE streams — missing credentials", { blockers });
    log.warn("See recorder output offline with: npm run worker -- --demo");
    return;
  }

  const auth = new TxlineAuth(config.txlineOrigin, log, {
    jwt: config.tokens.jwt || undefined,
    apiToken: config.tokens.apiToken || undefined,
  });
  if (!auth.accessJwt) await auth.startGuest();
  if (!auth.accessApiToken) {
    await activateWithKeypair(
      auth,
      {
        keypairPath: config.activation.keypairPath,
        txSig: config.activation.txSig,
        leagues: config.activation.leagues,
      },
      log,
    );
  }

  const http = new TxlineHttp(config.txlineOrigin, auth);
  const fixtures = await loadFixtures(http, { competitionId: config.competitionId });
  log.info("Fixtures loaded", { count: fixtures.length });

  const target =
    process.env.TARGET_FIXTURE_ID ?? findFixtureByTeams(fixtures, "France", "Morocco")?.id;
  if (target) log.info("Targeting fixture", { fixtureId: target });
  else log.info("No single target fixture resolved; ingesting all fixtures");

  const controller = new AbortController();
  installShutdown(controller, log);

  const recorder = new CorpusRecorder(config.corpusDir, config.net, log);
  const ctx = { http, recorder, log, signal: controller.signal, fixtureId: target };
  try {
    await Promise.all([startScoresIngest(ctx), startOddsIngest(ctx)]);
  } finally {
    await recorder.close();
  }
}

function installShutdown(controller: AbortController, log: Logger): void {
  const shutdown = (signal: string): void => {
    log.info(`Received ${signal}; shutting down`);
    controller.abort();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const isDemo = process.argv.includes("--demo");

  log.info("FullTime worker starting", { ...describeConfig(config), mode: isDemo ? "demo" : "live" });

  if (isDemo) {
    await runDemo(config.corpusDir, log);
    return;
  }
  await runLive(config, log);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
