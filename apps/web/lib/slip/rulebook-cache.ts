import { SlipCompilerError, type CompiledRulebook, type SlipClient } from "@slip/sdk";

import type { SlipBrowserConfiguration } from "@/lib/slip/config";

const CACHE_VERSION = 2;

type RulebookRequest = {
  fixtureId: string;
  question: string;
  outcomeLabels?: Array<string>;
  fixture?: { competition: string; home: string; away: string; kickoff: number; gameState?: number };
};

type StoredRulebook = Omit<CompiledRulebook, "bands"> & {
  bands: Array<{ lowerInclusive: string | null; upperExclusive: string | null; outcomeIndex: number }>;
};

type CachedResolution =
  | { version: typeof CACHE_VERSION; status: "resolvable"; rulebook: StoredRulebook }
  | { version: typeof CACHE_VERSION; status: "unresolvable"; message: string };

export type PollResolution =
  | { status: "resolvable"; rulebook: CompiledRulebook; cached: boolean }
  | { status: "unresolvable"; message: string; cached: boolean };

const inFlight = new Map<string, Promise<PollResolution>>();

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

async function cacheKey(configuration: SlipBrowserConfiguration, request: RulebookRequest): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({
    version: CACHE_VERSION,
    network: configuration.network,
    program: configuration.program,
    mint: configuration.mint,
    compilerOrigin: configuration.compilerOrigin,
    ...request,
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return `fulltime:slip-rulebook:${hash}`;
}

function serializeRulebook(rulebook: CompiledRulebook): StoredRulebook {
  return {
    ...rulebook,
    bands: rulebook.bands.map((band) => ({
      lowerInclusive: band.lowerInclusive?.toString() ?? null,
      upperExclusive: band.upperExclusive?.toString() ?? null,
      outcomeIndex: band.outcomeIndex,
    })),
  };
}

function deserializeRulebook(rulebook: StoredRulebook): CompiledRulebook {
  return {
    ...rulebook,
    bands: rulebook.bands.map((band) => ({
      lowerInclusive: band.lowerInclusive === null ? null : BigInt(band.lowerInclusive),
      upperExclusive: band.upperExclusive === null ? null : BigInt(band.upperExclusive),
      outcomeIndex: band.outcomeIndex,
    })),
  };
}

function readCached(key: string): PollResolution | null {
  const target = storage();
  if (!target) return null;
  try {
    const cached = JSON.parse(target.getItem(key) ?? "null") as CachedResolution | null;
    if (!cached || cached.version !== CACHE_VERSION) {
      target.removeItem(key);
      return null;
    }
    return cached.status === "resolvable"
      ? { status: "resolvable", rulebook: deserializeRulebook(cached.rulebook), cached: true }
      : { status: "unresolvable", message: cached.message, cached: true };
  } catch {
    target.removeItem(key);
    return null;
  }
}

function writeCached(key: string, resolution: PollResolution): void {
  const target = storage();
  if (!target) return;
  const cached: CachedResolution = resolution.status === "resolvable"
    ? { version: CACHE_VERSION, status: "resolvable", rulebook: serializeRulebook(resolution.rulebook) }
    : { version: CACHE_VERSION, status: "unresolvable", message: resolution.message };
  try { target.setItem(key, JSON.stringify(cached)); } catch { /* Cache pressure must not block real compilation. */ }
}

export async function resolvePollRulebook(input: {
  client: SlipClient;
  configuration: SlipBrowserConfiguration;
  request: RulebookRequest;
}): Promise<PollResolution> {
  const key = await cacheKey(input.configuration, input.request);
  const cached = readCached(key);
  if (cached) return cached;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const compilation = (async (): Promise<PollResolution> => {
    const supported = await input.client.supportsUnifiedMarkets();
    if (!supported) throw new Error("This Slip program does not support unified markets yet");
    try {
      const rulebook = await input.client.compileRulebook(input.request);
      const resolution: PollResolution = { status: "resolvable", rulebook, cached: false };
      writeCached(key, resolution);
      return resolution;
    } catch (cause) {
      if (cause instanceof SlipCompilerError && cause.code === "uncompilable_rule") {
        const resolution: PollResolution = { status: "unresolvable", message: cause.message, cached: false };
        writeCached(key, resolution);
        return resolution;
      }
      throw cause;
    }
  })();
  inFlight.set(key, compilation);
  try { return await compilation; }
  finally { inFlight.delete(key); }
}

export async function cacheResolvedPollRulebook(input: {
  configuration: SlipBrowserConfiguration;
  request: RulebookRequest;
  rulebook: CompiledRulebook;
}): Promise<void> {
  const key = await cacheKey(input.configuration, input.request);
  writeCached(key, { status: "resolvable", rulebook: input.rulebook, cached: false });
}
