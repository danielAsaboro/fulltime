/**
 * Worker configuration. Loads the repo-root `.env` (no dotenv dependency — Node's
 * own env-file loader), resolves the active TxLINE origin from `TXLINE_NET`, and
 * exposes typed config. Secrets are never logged; `describeConfig` returns a
 * redacted view for the startup banner.
 */

import fs from "node:fs";
import path from "node:path";

import type { LogLevel } from "./logger.js";

export type TxlineNet = "devnet" | "mainnet";

export interface WorkerConfig {
  net: TxlineNet;
  /** The origin for the active network — what every TxLINE request targets. */
  txlineOrigin: string;
  origins: { devnet: string; mainnet: string };
  supabase: { url: string; anonKey: string; serviceKey: string };
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
      } catch {
        // A malformed .env shouldn't crash startup; env may also be set externally.
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

  const origins = {
    devnet: process.env.TXLINE_DEVNET_ORIGIN ?? DEFAULT_ORIGINS.devnet,
    mainnet: process.env.TXLINE_MAINNET_ORIGIN ?? DEFAULT_ORIGINS.mainnet,
  };
  const net = normalizeNet(process.env.TXLINE_NET);

  return {
    net,
    txlineOrigin: origins[net],
    origins,
    supabase: {
      url: process.env.SUPABASE_URL ?? "",
      anonKey: process.env.SUPABASE_ANON_KEY ?? "",
      serviceKey: process.env.SUPABASE_SERVICE_KEY ?? "",
    },
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
    logLevel: normalizeLogLevel(process.env.LOG_LEVEL),
  };
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
    competitionId: config.competitionId ?? "all",
    apiTokenSeeded: Boolean(config.tokens.apiToken),
    activationReady: Boolean(config.activation.keypairPath && config.activation.txSig),
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
