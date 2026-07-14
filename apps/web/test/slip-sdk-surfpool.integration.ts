import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  address,
  createKeyPairSignerFromBytes,
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { Surfnet } from "@solana/surfpool";
import { calculateRulebookHash, createSlipClient, type ArchivedTxlineScoresProofV3, type CompiledRulebook } from "@slip/sdk";
import { sendSlipInstructions, type ConnectedSlipWallet } from "../lib/slip/wallet";

const PROGRAM = address("8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw");
const TXLINE_PROGRAM = address("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MINT = address("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
const FIXTURE_ID = 18_213_979;
const KICKOFF = 1_783_803_600;
const ROOTS_ADDRESS = address("EdJuEftTBNwXRWJpvYCziVxKT87qMDVu9V6HC7PwGffB");
const ARCHIVE = path.resolve(import.meta.dirname, "../../../../resources/fixtures/world-cup-2026/18213979-norway-vs-england");

function tokenMint(authority: Address): Uint8Array {
  const data = new Uint8Array(82);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  data.set(getAddressEncoder().encode(authority), 4);
  data[44] = 6;
  data[45] = 1;
  return data;
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string } };
  if (payload.error) throw new Error(`${method} failed (${payload.error.code}): ${payload.error.message}`);
  return payload.result as T;
}

async function connectedWallet(signer: KeyPairSigner): Promise<ConnectedSlipWallet> {
  return {
    name: `Surfpool ${signer.address.slice(0, 6)}`,
    address: signer.address,
    chain: "solana:devnet",
    signTransaction: async (transaction) => {
      const decoded = getTransactionDecoder().decode(transaction);
      const signed = await signTransaction([signer.keyPair], decoded);
      return new Uint8Array(getTransactionEncoder().encode(signed));
    },
  };
}

async function send(rpcUrl: string, wallet: ConnectedSlipWallet, instructions: Parameters<typeof sendSlipInstructions>[0]["instructions"]): Promise<string> {
  return sendSlipInstructions({ rpcUrl, wallet, instructions });
}

async function balance(rpcUrl: string, tokenAccount: string): Promise<bigint> {
  const result = await rpc<{ value: { amount: string } }>(rpcUrl, "getTokenAccountBalance", [tokenAccount, { commitment: "confirmed" }]);
  return BigInt(result.value.amount);
}

async function chainTime(rpcUrl: string): Promise<number> {
  const slot = await rpc<number>(rpcUrl, "getSlot", [{ commitment: "confirmed" }]);
  return (await rpc<number>(rpcUrl, "getBlockTime", [slot])) ?? Math.floor(Date.now() / 1_000);
}

function fiveOutcomeRulebook(replayKickoff: number): Omit<CompiledRulebook, "hash"> {
  return {
    version: 1,
    fixtureId: String(FIXTURE_ID),
    question: "How many total goals will be scored?",
    sentence: "Full-time home and away goals are added and partitioned into five exact bands.",
    expression: { fixtureId: FIXTURE_ID, settlementMode: "Terminal", period: 100, statAKey: 1, statASide: "Home", statBKey: 2, statBSide: "Away", op: "Add" },
    outcomeLabels: ["0", "1", "2", "3", "4+"],
    bands: [
      { lowerInclusive: null, upperExclusive: BigInt(1), outcomeIndex: 0 },
      { lowerInclusive: BigInt(1), upperExclusive: BigInt(2), outcomeIndex: 1 },
      { lowerInclusive: BigInt(2), upperExclusive: BigInt(3), outcomeIndex: 2 },
      { lowerInclusive: BigInt(3), upperExclusive: BigInt(4), outcomeIndex: 3 },
      { lowerInclusive: BigInt(4), upperExclusive: null, outcomeIndex: 4 },
    ],
    entryDeadline: replayKickoff - 5 * 60,
    resolveAt: replayKickoff + 4 * 60 * 60,
    voidAt: replayKickoff + 48 * 60 * 60,
    feeBps: 50,
    tipBps: 20,
  };
}

test("packed SDK crosses FullTime Wallet Standard boundary through the real Slip SBF lifecycle", { timeout: 120_000 }, async () => {
  const surfnet = Surfnet.startWithConfig({ offline: true, blockProductionMode: "transaction" });
  try {
    surfnet.deploy({ programId: PROGRAM, soPath: path.resolve(import.meta.dirname, "../../../vendor/slip.so") });
    surfnet.setAccount(MINT, 2_000_000, tokenMint(address(surfnet.payer)), TOKEN_PROGRAM);
    const rootResponse = JSON.parse(readFileSync(path.join(ARCHIVE, "daily-scores-roots.20645.devnet.json"), "utf8")) as {
      result: { value: { data: [string, "base64"]; lamports: number; owner: string } };
    };
    assert.equal(rootResponse.result.value.owner, TXLINE_PROGRAM);
    surfnet.setAccount(ROOTS_ADDRESS, rootResponse.result.value.lamports, Buffer.from(rootResponse.result.value.data[0], "base64"), TXLINE_PROGRAM);
    const archivedProof = JSON.parse(readFileSync(path.join(ARCHIVE, "scores.terminal-proof-v3.1-2-3-4-5.json"), "utf8")) as ArchivedTxlineScoresProofV3;
    assert.ok(Number(archivedProof.ts) / 1_000 > KICKOFF, "terminal proof must follow the archived kickoff");

    const makerInfo = Surfnet.newKeypair();
    const takerInfo = Surfnet.newKeypair();
    const maker = await createKeyPairSignerFromBytes(new Uint8Array(makerInfo.secretKey));
    const taker = await createKeyPairSignerFromBytes(new Uint8Array(takerInfo.secretKey));
    const makerWallet = await connectedWallet(maker);
    const takerWallet = await connectedWallet(taker);
    surfnet.fundSolMany([{ address: maker.address, lamports: 5_000_000_000 }, { address: taker.address, lamports: 5_000_000_000 }]);
    surfnet.fundTokenMany([maker.address, taker.address], MINT, 1_000_000_000);

    const client = createSlipClient({
      network: "localnet",
      rpcUrl: surfnet.rpcUrl,
      websocketUrl: surfnet.wsUrl,
      programAddress: PROGRAM,
      settlementMint: MINT,
    });
    assert.equal(await client.supportsUnifiedMarkets(), true);

    const replayStartedAt = await chainTime(surfnet.rpcUrl);
    const replayKickoff = replayStartedAt + 10 * 60;
    const base = fiveOutcomeRulebook(replayKickoff);
    const rulebook = { ...base, hash: await calculateRulebookHash(base) };
    const created = await client.createMarket({ id: BigInt(70_001), creator: maker.address, rulebook });
    const creationSignature = await send(surfnet.rpcUrl, makerWallet, created.instructions);
    assert.match(creationSignature, /^[1-9A-HJ-NP-Za-km-z]+$/);

    const winning = await client.buyTicket({ market: created.market, buyer: maker.address, outcomeIndex: 3, amount: BigInt(3_000_000), nonce: BigInt(1) });
    const losing = await client.buyTicket({ market: created.market, buyer: taker.address, outcomeIndex: 0, amount: BigInt(2_000_000), nonce: BigInt(2) });
    await send(surfnet.rpcUrl, makerWallet, winning.instructions);
    await send(surfnet.rpcUrl, takerWallet, losing.instructions);

    const open = await client.getMarket(created.market);
    assert.deepEqual(open.outcomeLabels, ["0", "1", "2", "3", "4+"]);
    assert.deepEqual(open.pools, [BigInt(2_000_000), BigInt(0), BigInt(0), BigInt(3_000_000), BigInt(0)]);
    assert.equal(await balance(surfnet.rpcUrl, surfnet.getAta(created.market, MINT)), BigInt(5_000_000));
    assert.equal((await client.listWalletTickets(maker.address))[0]?.stake, BigInt(3_000_000));

    const refundBase = { ...fiveOutcomeRulebook(replayKickoff), outcomeLabels: ["Draw", "Not draw"], bands: [
      { lowerInclusive: null, upperExclusive: BigInt(0), outcomeIndex: 1 },
      { lowerInclusive: BigInt(0), upperExclusive: BigInt(1), outcomeIndex: 0 },
      { lowerInclusive: BigInt(1), upperExclusive: null, outcomeIndex: 1 },
    ] };
    const refundRulebook = { ...refundBase, hash: await calculateRulebookHash(refundBase) };
    const refundable = await client.createMarket({ id: BigInt(70_002), creator: maker.address, rulebook: refundRulebook });
    await send(surfnet.rpcUrl, makerWallet, refundable.instructions);
    const refundTicket = await client.buyTicket({ market: refundable.market, buyer: maker.address, outcomeIndex: 0, amount: BigInt(1_000_000), nonce: BigInt(9) });
    await send(surfnet.rpcUrl, makerWallet, refundTicket.instructions);

    surfnet.timeTravelToTimestamp((base.resolveAt + 1) * 1_000);
    const late = await client.buyTicket({ market: created.market, buyer: taker.address, outcomeIndex: 4, amount: BigInt(1_000_000), nonce: BigInt(3) });
    await assert.rejects(send(surfnet.rpcUrl, takerWallet, late.instructions), /EntryClosed|custom program error/);

    const resolverBefore = await balance(surfnet.rpcUrl, surfnet.getAta(taker.address, MINT));
    await send(surfnet.rpcUrl, takerWallet, await client.resolveMarketV3({
      market: created.market,
      resolver: taker.address,
      dailyScoresRoots: ROOTS_ADDRESS,
      proof: archivedProof,
    }));
    const resolved = await client.getMarket(created.market);
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.winningOutcome, 3);
    assert.equal(await balance(surfnet.rpcUrl, surfnet.getAta(taker.address, MINT)) - resolverBefore, BigInt(10_000));

    await assert.rejects(send(surfnet.rpcUrl, makerWallet, await client.claimTicket({ market: created.market, ticket: losing.ticket, caller: maker.address })), /LosingTicket|custom program error/);
    const makerBefore = await balance(surfnet.rpcUrl, surfnet.getAta(maker.address, MINT));
    await send(surfnet.rpcUrl, takerWallet, await client.claimTicket({ market: created.market, ticket: winning.ticket, caller: taker.address }));
    assert.equal(await balance(surfnet.rpcUrl, surfnet.getAta(maker.address, MINT)) - makerBefore, BigInt(4_965_000));
    assert.equal(await balance(surfnet.rpcUrl, surfnet.getAta(created.market, MINT)), BigInt(0));
    await assert.rejects(send(surfnet.rpcUrl, takerWallet, await client.claimTicket({ market: created.market, ticket: winning.ticket, caller: taker.address })), /TicketAlreadyClaimed|custom program error/);

    await send(surfnet.rpcUrl, takerWallet, client.voidMarket({ market: refundable.market, caller: taker.address }));
    const refundBefore = await balance(surfnet.rpcUrl, surfnet.getAta(maker.address, MINT));
    await send(surfnet.rpcUrl, takerWallet, await client.claimRefund({ market: refundable.market, ticket: refundTicket.ticket, caller: taker.address }));
    assert.equal(await balance(surfnet.rpcUrl, surfnet.getAta(maker.address, MINT)) - refundBefore, BigInt(1_000_000));
    assert.equal((await client.getMarket(refundable.market)).status, "voided");
  } finally {
    surfnet.stop();
  }
});
