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
  activationKeypairPath: string;
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
    activationKeypairPath: process.env.ACTIVATION_KEYPAIR_PATH ?? "",
    corpusDir: process.env.CORPUS_DIR ?? "corpus",
    logLevel: normalizeLogLevel(process.env.LOG_LEVEL),
  };
}

/** Redacted, secret-free view for logging. */
export function describeConfig(config: WorkerConfig): Record<string, unknown> {
  return {
    net: config.net,
    txlineOrigin: config.txlineOrigin,
    corpusDir: config.corpusDir,
    supabaseConfigured: Boolean(config.supabase.url && config.supabase.serviceKey),
    activationKeypairConfigured: Boolean(config.activationKeypairPath),
  };
}

/** Names of the credentials Phase 1 needs to connect live; empty ⇒ ready. */
export function missingLiveCredentials(config: WorkerConfig): string[] {
  const missing: string[] = [];
  if (!config.activationKeypairPath) missing.push("ACTIVATION_KEYPAIR_PATH");
  if (!config.supabase.url) missing.push("SUPABASE_URL");
  if (!config.supabase.serviceKey) missing.push("SUPABASE_SERVICE_KEY");
  return missing;
}
