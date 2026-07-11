/**
 * FullTime worker entry — the TxLINE spine.
 *
 * Live mode: guest JWT → (fast-path token, or on-chain-backed activation) →
 * fixtures snapshot → scores + odds SSE → seq-ordered fixture state machines →
 * corpus recorder + publisher-signed public Hypercore. Feed time is authoritative
 * throughout.
 *
 *   npm run operator:publisher live ingest + signed public manifest service
 */

import path from "node:path";

import {
  describeConfig,
  loadConfig,
  manifestBlockers,
  streamingBlockers,
  type WorkerConfig,
} from "./config.js";
import { startOddsIngest, startScoresIngest } from "./ingest.js";
import { createLogger, type Logger } from "./logger.js";
import { FixturePlanePublisher } from "./publisher/fixture-publisher.js";
import {
  createSignedNetworkManifest,
  loadManifestSigningKey,
  manifestVerificationPublicKey,
  startNetworkManifestService,
  type NetworkManifestService,
} from "./network-manifest.js";
import { CorpusRecorder } from "./recorder/recorder.js";
import { activateWithKeypair } from "./txline/activation.js";
import { TxlineAuth } from "./txline/auth.js";
import { loadFixtures } from "./txline/fixtures.js";
import { TxlineHttp } from "./txline/http.js";

async function runLive(config: WorkerConfig, log: Logger): Promise<void> {
  const blockers = [...streamingBlockers(config), ...manifestBlockers(config)];
  if (blockers.length > 0) {
    throw new Error(`Cannot start FullTime operator service: ${blockers.join(", ")}`);
  }

  const controller = new AbortController();
  installShutdown(controller, log);
  const publisher = new FixturePlanePublisher({
    storageDir: path.join(config.fixturePlaneDir, config.net),
    log,
  });
  let recorder: CorpusRecorder | null = null;
  let manifestService: NetworkManifestService | null = null;
  let publisherFailure: unknown = null;
  try {
    const descriptor = await publisher.open();
    const signingKey = await loadManifestSigningKey(config.manifest.signingKeyPath);
    const manifest = createSignedNetworkManifest({
      fixtureFeedKey: descriptor.key,
      ...(config.manifest.answerAttestor ? { answerAttestor: config.manifest.answerAttestor } : {}),
      ...(config.manifest.anchorObserver ? { anchorObserver: config.manifest.anchorObserver } : {}),
    }, signingKey);
    assertManifestPublicUrl(config.manifest.publicUrl, config.manifest.pathname);
    manifestService = await startNetworkManifestService({
      manifest,
      host: config.manifest.host,
      port: config.manifest.port,
      pathname: config.manifest.pathname,
      tlsCertificatePath: config.manifest.tlsCertificatePath,
      tlsPrivateKeyPath: config.manifest.tlsPrivateKeyPath,
    });
    log.info("Signed fixture plane online", {
      version: descriptor.version,
      fixtureFeedKey: descriptor.key,
      discoveryKey: descriptor.discoveryKey,
      storageDir: descriptor.storageDir,
      manifestUrl: config.manifest.publicUrl,
      manifestVerificationPublicKey: manifestVerificationPublicKey(signingKey),
    });

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
    for (const fixture of fixtures) await publisher.publishFixture(fixture);

    // An explicit filter remains useful for diagnostics. Production no longer
    // silently narrows the feed to a hard-coded France–Morocco fixture.
    const target = process.env.TARGET_FIXTURE_ID || process.env.TXLINE_DEFAULT_FIXTURE_ID || undefined;
    if (target) log.info("Explicitly targeting fixture", { fixtureId: target });
    else log.info("Ingesting all fixture updates");

    recorder = new CorpusRecorder(config.corpusDir, config.net, log);
    const onPublisherError = (error: unknown): void => {
      if (publisherFailure !== null) return;
      publisherFailure = error;
      log.error("Signed fixture-plane append failed; stopping ingest", { error: String(error) });
      controller.abort();
    };
    const ctx = {
      http,
      recorder,
      publisher,
      onPublisherError,
      log,
      signal: controller.signal,
      ...(target ? { fixtureId: target } : {}),
    };
    await Promise.all([startScoresIngest(ctx), startOddsIngest(ctx)]);
    await publisher.flush();
    if (publisherFailure !== null) throw publisherFailure;
  } finally {
    await recorder?.close();
    await manifestService?.close();
    await publisher.close();
  }
}

function assertManifestPublicUrl(value: string, pathname: string): void {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch (error) {
    throw new Error("FULLTIME_MANIFEST_PUBLIC_URL must be a valid HTTPS URL", { cause: error });
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== pathname) {
    throw new Error("FULLTIME_MANIFEST_PUBLIC_URL must be credential-free HTTPS and match FULLTIME_MANIFEST_PATH");
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

  log.info("FullTime worker starting", { ...describeConfig(config), mode: "live" });
  await runLive(config, log);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
