import assert from "node:assert/strict";
import test from "node:test";
import { SlipCompilerError, type CompiledRulebook, type SlipClient } from "@mutinylabs/slip";

import { resolvePollRulebook } from "../lib/slip/rulebook-cache";

const configuration = {
  network: "localnet" as const,
  rpcUrl: "http://127.0.0.1:8899",
  program: "8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw",
  mint: "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh",
  compilerOrigin: "http://127.0.0.1:3000",
};

const request = { fixtureId: "9001", question: "Who wins?", outcomeLabels: ["France", "Draw", "Morocco"] };

const rulebook: CompiledRulebook = {
  version: 1,
  fixtureId: request.fixtureId,
  question: request.question,
  outcomeLabels: request.outcomeLabels,
  sentence: "Full-time result.",
  expression: { fixtureId: 9001, settlementMode: "Terminal", period: 100, statAKey: 1, statASide: "Home", statBKey: 2, statBSide: "Away", op: "Sub" },
  bands: [
    { lowerInclusive: null, upperExclusive: BigInt(0), outcomeIndex: 2 },
    { lowerInclusive: BigInt(0), upperExclusive: BigInt(1), outcomeIndex: 1 },
    { lowerInclusive: BigInt(1), upperExclusive: null, outcomeIndex: 0 },
  ],
  entryDeadline: 2_000_000_000,
  resolveAt: 2_000_014_700,
  voidAt: 2_000_172_800,
  feeBps: 50,
  tipBps: 20,
  hash: "a".repeat(64),
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("caches a canonical Rulebook and restores bigint bands", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage() });
  let compilationCount = 0;
  const client = {
    supportsUnifiedMarkets: async () => true,
    compileRulebook: async () => { compilationCount += 1; return rulebook; },
  } as unknown as SlipClient;

  const first = await resolvePollRulebook({ client, configuration, request });
  const second = await resolvePollRulebook({ client, configuration, request });
  assert.equal(first.status, "resolvable");
  assert.equal(second.status, "resolvable");
  assert.equal(second.cached, true);
  assert.equal(second.status === "resolvable" ? second.rulebook.bands[1]!.lowerInclusive : null, BigInt(0));
  assert.equal(compilationCount, 1);
});

test("negative-caches only deterministic uncompilable rules", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage() });
  let compilationCount = 0;
  const client = {
    supportsUnifiedMarkets: async () => true,
    compileRulebook: async () => {
      compilationCount += 1;
      throw new SlipCompilerError("Player identity is not provable.", "uncompilable_rule", 422);
    },
  } as unknown as SlipClient;

  const first = await resolvePollRulebook({ client, configuration, request: { ...request, question: "Will Mbappe score?" } });
  const second = await resolvePollRulebook({ client, configuration, request: { ...request, question: "Will Mbappe score?" } });
  assert.equal(first.status, "unresolvable");
  assert.equal(second.cached, true);
  assert.equal(compilationCount, 1);
});
