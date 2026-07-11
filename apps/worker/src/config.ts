/**
 * Worker configuration. Loads the repo-root `.env` (no dotenv dependency — Node's
 * own env-file loader), resolves the active TxLINE origin from `TXLINE_NET`, and
 * exposes typed config. Secrets are never logged; `describeConfig` returns a
 * redacted view for the startup banner.
 */

import fs from "node:fs";
import path from "node:path";

import type { LogLevel } from "./logger.js";
import type { AnchorObserverPin, AnswerAttestorPins } from "./network-manifest.js";

export type TxlineNet = "devnet" | "mainnet";

export interface WorkerConfig {
  net: TxlineNet;
  /** The origin for the active network — what every TxLINE request targets. */
  txlineOrigin: string;
  origins: { devnet: string; mainnet: string };
  /** Pre-obtained tokens (fast path): stream immediately, skip on-chain activation. */
  tokens: { jwt: string; apiToken: string };
  /** Inputs to sign + exchange activation when no API token is seeded. */
  activation: {
    keypairPath: string;
    /** Confirmed on-chain `subscribe` signature (produced with a funded wallet). */
    txSig: string;
    leagues: number[];
    serviceLevel: number;
  };
  /** World Cup competition id to filter the fixtures snapshot (undefined ⇒ no filter). */
  competitionId: number | undefined;
  corpusDir: string;
  /** Persistent storage root for the single-writer signed public fixture Hypercore. */
  fixturePlaneDir: string;
  /** Operator-only service settings for the signed public network manifest. */
  manifest: {
    signingKeyPath: string;
    tlsCertificatePath: string;
    tlsPrivateKeyPath: string;
    host: string;
    port: number;
    pathname: string;
    publicUrl: string;
    answerAttestor: AnswerAttestorPins | null;
    anchorObserver: AnchorObserverPin | null;
  };
  logLevel: LogLevel;
}

const DEFAULT_ORIGINS = {
  devnet: "https://txline-dev.txodds.com",
  mainnet: "https://txline.txodds.com",
} as const;

/** Load the first `.env` found at cwd or two levels up (the monorepo root). */
export function loadDotEnv(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch (error) {
        throw new Error(`Could not load environment file ${candidate}`, { cause: error });
      }
      return candidate;
    }
  }
  return null;
}

function normalizeNet(raw: string | undefined): TxlineNet {
  return raw === "mainnet" ? "mainnet" : "devnet";
}

function normalizeLogLevel(raw: string | undefined): LogLevel {
  return raw === "debug" || raw === "warn" || raw === "error" ? raw : "info";
}

export function loadConfig(): WorkerConfig {
  loadDotEnv();

  const baseOrigin = process.env.TXLINE_BASE_URL ? normalizeOrigin(process.env.TXLINE_BASE_URL) : null;
  const origins = {
    devnet: normalizeOrigin(process.env.TXLINE_DEVNET_ORIGIN ?? DEFAULT_ORIGINS.devnet),
    mainnet: normalizeOrigin(process.env.TXLINE_MAINNET_ORIGIN ?? DEFAULT_ORIGINS.mainnet),
  };
  const net = process.env.TXLINE_NET
    ? normalizeNet(process.env.TXLINE_NET)
    : inferNet(baseOrigin);

  return {
    net,
    txlineOrigin: baseOrigin ?? origins[net],
    origins,
    tokens: {
      jwt: process.env.TXLINE_JWT ?? "",
      apiToken: process.env.TXLINE_API_TOKEN ?? "",
    },
    activation: {
      keypairPath: process.env.ACTIVATION_KEYPAIR_PATH ?? "",
      txSig: process.env.ACTIVATION_TX_SIG ?? "",
      leagues: parseLeagues(process.env.TXLINE_LEAGUES),
      serviceLevel: parseIntOr(process.env.TXLINE_SERVICE_LEVEL, net === "mainnet" ? 12 : 1),
    },
    competitionId: parseOptionalInt(process.env.WORLDCUP_COMPETITION_ID),
    corpusDir: process.env.CORPUS_DIR ?? "corpus",
    fixturePlaneDir: process.env.FIXTURE_PLANE_DIR ?? "fixture-plane",
    manifest: {
      signingKeyPath: process.env.FULLTIME_MANIFEST_SIGNING_KEY_PATH ?? "",
      tlsCertificatePath: process.env.FULLTIME_MANIFEST_TLS_CERT_PATH ?? "",
      tlsPrivateKeyPath: process.env.FULLTIME_MANIFEST_TLS_KEY_PATH ?? "",
      host: process.env.FULLTIME_MANIFEST_HOST ?? "",
      port: parseIntOr(process.env.FULLTIME_MANIFEST_PORT, 443),
      pathname: process.env.FULLTIME_MANIFEST_PATH ?? "/v1/network.json",
      publicUrl: process.env.FULLTIME_MANIFEST_PUBLIC_URL ?? "",
      answerAttestor: parseAnswerAttestorPins(process.env),
      anchorObserver: parseAnchorObserverPin(process.env),
    },
    logLevel: normalizeLogLevel(process.env.LOG_LEVEL),
  };
}

function normalizeOrigin(raw: string): string {
  let value: URL;
  try {
    value = new URL(raw);
  } catch (error) {
    throw new Error("TxLINE origin is invalid", { cause: error });
  }
  if (value.protocol !== "https:" || value.username || value.password || value.search || value.hash) {
    throw new Error("TxLINE origin must be credential-free HTTPS");
  }
  return value.origin;
}

function inferNet(origin: string | null): TxlineNet {
  return origin && /(?:^|[.-])dev(?:[.-]|$)/i.test(new URL(origin).hostname) ? "devnet" : "mainnet";
}

function parseAnswerAttestorPins(env: NodeJS.ProcessEnv): AnswerAttestorPins | null {
  const servicePublicKey = env.FULLTIME_ANSWER_ATTESTOR_PUBLIC_KEY;
  const receiptFeedKey = env.FULLTIME_ANSWER_RECEIPT_FEED_KEY;
  if (!servicePublicKey && !receiptFeedKey) return null;
  return { servicePublicKey: servicePublicKey ?? "", receiptFeedKey: receiptFeedKey ?? "" };
}

function parseAnchorObserverPin(env: NodeJS.ProcessEnv): AnchorObserverPin | null {
  const publicKey = env.FULLTIME_ANCHOR_OBSERVER_PUBLIC_KEY;
  const endpoint = env.FULLTIME_ANCHOR_OBSERVER_ENDPOINT;
  if (!publicKey && !endpoint) return null;
  return { publicKey: publicKey ?? "", endpoint: endpoint ?? "" };
}

function parseLeagues(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Redacted, secret-free view for logging. */
export function describeConfig(config: WorkerConfig): Record<string, unknown> {
  return {
    net: config.net,
    txlineOrigin: config.txlineOrigin,
    corpusDir: config.corpusDir,
    fixturePlaneDir: config.fixturePlaneDir,
    competitionId: config.competitionId ?? "all",
    apiTokenSeeded: Boolean(config.tokens.apiToken),
    activationReady: Boolean(config.activation.keypairPath && config.activation.txSig),
    manifestServiceConfigured: manifestBlockers(config).length === 0,
  };
}

/**
 * What's missing before the worker can open the TxLINE streams. Empty ⇒ ready.
 * A seeded API token is sufficient; otherwise activation needs a keypair + txSig.
 */
export function streamingBlockers(config: WorkerConfig): string[] {
  if (config.tokens.apiToken) return [];
  const missing: string[] = [];
  if (!config.activation.keypairPath) {
    missing.push("TXLINE_API_TOKEN (fast path) or ACTIVATION_KEYPAIR_PATH");
  }
  if (!config.activation.txSig) missing.push("ACTIVATION_TX_SIG");
  return missing;
}

/** Required operator boundary: the publisher must expose a signed HTTPS trust document. */
export function manifestBlockers(config: WorkerConfig): string[] {
  const missing: string[] = [];
  const manifest = config.manifest;
  if (!manifest.signingKeyPath) missing.push("FULLTIME_MANIFEST_SIGNING_KEY_PATH");
  if (!manifest.tlsCertificatePath) missing.push("FULLTIME_MANIFEST_TLS_CERT_PATH");
  if (!manifest.tlsPrivateKeyPath) missing.push("FULLTIME_MANIFEST_TLS_KEY_PATH");
  if (!manifest.host) missing.push("FULLTIME_MANIFEST_HOST");
  if (!manifest.publicUrl) missing.push("FULLTIME_MANIFEST_PUBLIC_URL");
  if (manifest.answerAttestor && (!manifest.answerAttestor.servicePublicKey || !manifest.answerAttestor.receiptFeedKey)) {
    missing.push("FULLTIME_ANSWER_ATTESTOR_PUBLIC_KEY and FULLTIME_ANSWER_RECEIPT_FEED_KEY together");
  }
  if (manifest.anchorObserver && (!manifest.anchorObserver.publicKey || !manifest.anchorObserver.endpoint)) {
    missing.push("FULLTIME_ANCHOR_OBSERVER_PUBLIC_KEY and FULLTIME_ANCHOR_OBSERVER_ENDPOINT together");
  }
  return missing;
}
