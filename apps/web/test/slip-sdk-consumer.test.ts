import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import { calculateRulebookHash, createSlipClient, type CompiledRulebook } from "@mutinylabs/slip";

test("FullTime consumes only the packed public SDK for a five-outcome creation", async () => {
  const base: Omit<CompiledRulebook, "hash"> = {
    version: 1,
    fixtureId: "9001",
    question: "How many goals will be scored?",
    outcomeLabels: ["0", "1", "2", "3", "4+"],
    sentence: "Full-time total goals are partitioned into 0, 1, 2, 3, or 4+.",
    expression: { fixtureId: 9001, settlementMode: "Terminal", period: 100, statAKey: 1, statASide: "Home", statBKey: 2, statBSide: "Away", op: "Add" },
    bands: [
      { lowerInclusive: null, upperExclusive: BigInt(1), outcomeIndex: 0 },
      { lowerInclusive: BigInt(1), upperExclusive: BigInt(2), outcomeIndex: 1 },
      { lowerInclusive: BigInt(2), upperExclusive: BigInt(3), outcomeIndex: 2 },
      { lowerInclusive: BigInt(3), upperExclusive: BigInt(4), outcomeIndex: 3 },
      { lowerInclusive: BigInt(4), upperExclusive: null, outcomeIndex: 4 },
    ],
    entryDeadline: 2_000_000_000,
    resolveAt: 2_000_014_700,
    voidAt: 2_000_172_800,
    feeBps: 50,
    tipBps: 20,
  };
  const rulebook = { ...base, hash: await calculateRulebookHash(base) };
  const client = createSlipClient({ network: "localnet", rpcUrl: "http://127.0.0.1:8899", programAddress: address("8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw"), settlementMint: address("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh") });
  const built = await client.createMarket({ id: BigInt(42), creator: address("11111111111111111111111111111111"), rulebook });
  assert.equal(built.instructions.length, 1);
  assert.equal(built.instructions[0]!.programAddress, client.config.programAddress);
  assert.equal(rulebook.outcomeLabels[4], "4+");
});
