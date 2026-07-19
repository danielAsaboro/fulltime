import { calculateRulebookHash, createMarketReference, type CompiledRulebook, type MarketReferenceV1 } from "@mutinylabs/slip";

import { createFullTimeSlipClient, slipBrowserConfiguration } from "@/lib/slip/config";
import { sendSlipInstructions, type ConnectedSlipWallet } from "@/lib/slip/wallet";

function randomU64(): bigint {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (BigInt(words[0]!) << BigInt(32)) | BigInt(words[1]!);
}

async function chainTime(rpcUrl: string): Promise<number> {
  const call = async <T,>(method: string, params: unknown[]): Promise<T> => {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const payload = await response.json() as { result?: T; error?: { message: string } };
    if (!response.ok || payload.error) throw new Error(`Solana ${method} failed: ${payload.error?.message || `HTTP ${response.status}`}`);
    return payload.result as T;
  };
  const slot = await call<number>("getSlot", [{ commitment: "confirmed" }]);
  return (await call<number | null>("getBlockTime", [slot])) ?? Math.floor(Date.now() / 1_000);
}

export async function prepareRulebookForSigning(rulebook: CompiledRulebook): Promise<CompiledRulebook> {
  const config = slipBrowserConfiguration();
  if (!config || config.network !== "localnet") return rulebook;
  const now = await chainTime(config.rpcUrl);
  if (rulebook.entryDeadline > now) return rulebook;
  const replayKickoff = now + 10 * 60;
  const replayRulebook = {
    ...rulebook,
    entryDeadline: replayKickoff - 5 * 60,
    resolveAt: replayKickoff + 4 * 60 * 60,
    voidAt: replayKickoff + 48 * 60 * 60,
    hash: "",
  };
  return { ...replayRulebook, hash: await calculateRulebookHash(replayRulebook) };
}

export async function createMarketFromRulebook(input: {
  rulebook: CompiledRulebook;
  wallet: ConnectedSlipWallet;
}): Promise<MarketReferenceV1> {
  const config = slipBrowserConfiguration();
  if (!config) throw new Error("Slip market configuration is unavailable");
  const client = createFullTimeSlipClient();
  const built = await client.createMarket({ id: randomU64(), creator: input.wallet.address, rulebook: input.rulebook });
  const signature = await sendSlipInstructions({ wallet: input.wallet, rpcUrl: config.rpcUrl, instructions: built.instructions });
  return createMarketReference(client.config, {
    market: built.market,
    fixtureId: input.rulebook.fixtureId,
    rulebookHash: input.rulebook.hash,
    creationSignature: signature,
  });
}
