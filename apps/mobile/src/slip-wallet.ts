import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import b4a from "b4a";
import nacl from "tweetnacl";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import {
  createSlipClient,
  calculateRulebookHash,
  createMarketReference,
  verifyCompiledRulebookHash,
  type CompiledRulebook,
  type MarketReferenceV1,
  type MarketSnapshot,
  type TicketSnapshot,
} from "@slip/sdk";

const WALLET_KEY = "fulltime.slip-wallet.v1";
const verifiedReferences = new Map<string, Promise<void>>();

installSolanaDigest();

function installSolanaDigest(): void {
  const existing = globalThis.crypto;
  if (typeof existing?.subtle?.digest === "function") return;
  const subtle = Object.create(existing?.subtle ?? null) as SubtleCrypto;
  Object.defineProperty(subtle, "digest", {
    configurable: true,
    value: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase().replaceAll("_", "-");
      const expoAlgorithm = name === "SHA-256" ? Crypto.CryptoDigestAlgorithm.SHA256
        : name === "SHA-384" ? Crypto.CryptoDigestAlgorithm.SHA384
          : name === "SHA-512" ? Crypto.CryptoDigestAlgorithm.SHA512
            : null;
      if (!expoAlgorithm) throw new Error(`FullTime mobile does not support the ${name} digest algorithm`);
      return Crypto.digest(expoAlgorithm, data);
    },
  });
  const crypto = Object.create(existing ?? null) as globalThis.Crypto;
  Object.defineProperty(crypto, "subtle", { configurable: true, value: subtle });
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: crypto });
}

export interface MobileSlipConfiguration {
  network: "localnet" | "devnet" | "mainnet-beta";
  rpcUrl: string;
  fundingUrl: string;
  compilerUrl: string;
  program: string;
  mint: string;
}

export interface MobileSlipWallet { address: Address; secretKey: Uint8Array }

export async function loadMobileSlipWallet(config: MobileSlipConfiguration): Promise<MobileSlipWallet> {
  let secretKey: Uint8Array | null = null;
  const stored = await SecureStore.getItemAsync(WALLET_KEY);
  if (stored) {
    const decoded = b4a.from(stored, "base64");
    if (decoded.byteLength === nacl.sign.secretKeyLength) secretKey = decoded;
  }
  if (!secretKey) {
    secretKey = nacl.sign.keyPair.fromSeed(await Crypto.getRandomBytesAsync(nacl.sign.seedLength)).secretKey;
    await SecureStore.setItemAsync(WALLET_KEY, b4a.toString(secretKey, "base64"), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  const publicKey = secretKey.subarray(32);
  const wallet = { address: address(getBase58Decoder().decode(publicKey)), secretKey };
  if (config.network === "localnet") {
    const response = await fetch(config.fundingUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: wallet.address }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || `Device wallet funding failed with HTTP ${response.status}`);
  }
  return wallet;
}

export function createMobileSlipClient(config: MobileSlipConfiguration) {
  return createSlipClient({
    network: config.network,
    rpcUrl: config.rpcUrl,
    programAddress: address(config.program),
    settlementMint: address(config.mint),
  });
}

export async function verifyMobileMarketReference(
  config: MobileSlipConfiguration,
  reference: MarketReferenceV1,
): Promise<void> {
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([
      config.network,
      config.rpcUrl,
      config.program,
      config.mint,
      reference.version,
      reference.network,
      reference.program,
      reference.mint,
      reference.market,
      reference.fixtureId,
      reference.rulebookHash,
      reference.creationSignature,
    ]),
  );
  const cacheKey = `fulltime.slip-reference.${fingerprint}`;
  const existing = verifiedReferences.get(cacheKey);
  if (existing) return existing;
  const verification = (async () => {
    if (await SecureStore.getItemAsync(cacheKey) === "verified") return;
    await createMobileSlipClient(config).verifyReference(reference);
    await SecureStore.setItemAsync(cacheKey, "verified", {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  })();
  verifiedReferences.set(cacheKey, verification);
  try {
    await verification;
  } catch (error) {
    verifiedReferences.delete(cacheKey);
    throw error;
  }
}

export async function buyMobileTicket(input: {
  config: MobileSlipConfiguration;
  wallet: MobileSlipWallet;
  reference: MarketReferenceV1;
  outcomeIndex: number;
  amount: bigint;
}): Promise<{ signature: string; ticket: string }> {
  const client = createMobileSlipClient(input.config);
  await verifyMobileMarketReference(input.config, input.reference);
  const nonceBytes = await Crypto.getRandomBytesAsync(8);
  const nonce = new DataView(nonceBytes.buffer, nonceBytes.byteOffset, nonceBytes.byteLength).getBigUint64(0, true);
  const built = await client.buyTicket({
    market: address(input.reference.market),
    buyer: input.wallet.address,
    outcomeIndex: input.outcomeIndex,
    amount: input.amount,
    nonce,
  });
  const signature = await sendInstructions(input.config.rpcUrl, input.wallet, built.instructions);
  return { signature, ticket: built.ticket };
}

function randomU64(bytes: Uint8Array): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true);
}

export async function compileMobileRulebook(input: {
  config: MobileSlipConfiguration;
  fixtureId: string;
  fixture: { competition: string; home: string; away: string; kickoff: number; gameState?: number };
  question: string;
}): Promise<CompiledRulebook> {
  const response = await fetch(input.config.compilerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ fixtureId: input.fixtureId, question: input.question.trim(), fixture: input.fixture }),
  });
  const payload = await response.json().catch(() => null) as { data?: Omit<CompiledRulebook, "bands"> & { bands: Array<{ lowerInclusive: string | null; upperExclusive: string | null; outcomeIndex: number }> }; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || `Rulebook compilation failed with HTTP ${response.status}`);
  if (!payload?.data || payload.data.fixtureId !== input.fixtureId || payload.data.question !== input.question.trim()) throw new Error("Rulebook compiler returned mismatched fixture context");
  const rulebook: CompiledRulebook = { ...payload.data, bands: payload.data.bands.map((band) => ({ lowerInclusive: band.lowerInclusive === null ? null : BigInt(band.lowerInclusive), upperExclusive: band.upperExclusive === null ? null : BigInt(band.upperExclusive), outcomeIndex: band.outcomeIndex })) };
  await verifyCompiledRulebookHash(rulebook);
  return rulebook;
}

async function prepareMobileRulebook(config: MobileSlipConfiguration, rulebook: CompiledRulebook): Promise<CompiledRulebook> {
  if (config.network !== "localnet") return rulebook;
  const slot = await rpc<number>(config.rpcUrl, "getSlot", [{ commitment: "confirmed" }]);
  const now = await rpc<number | null>(config.rpcUrl, "getBlockTime", [slot]) ?? Math.floor(Date.now() / 1_000);
  if (rulebook.entryDeadline > now) return rulebook;
  const kickoff = now + 10 * 60;
  const base = { ...rulebook, entryDeadline: kickoff - 5 * 60, resolveAt: kickoff + 4 * 60 * 60, voidAt: kickoff + 48 * 60 * 60, hash: "" };
  return { ...base, hash: await calculateRulebookHash(base) };
}

export async function createMobileMarketReference(input: {
  config: MobileSlipConfiguration;
  wallet: MobileSlipWallet;
  rulebook: CompiledRulebook;
}): Promise<MarketReferenceV1> {
  const rulebook = await prepareMobileRulebook(input.config, input.rulebook);
  const client = createMobileSlipClient(input.config);
  const created = await client.createMarket({ id: randomU64(await Crypto.getRandomBytesAsync(8)), creator: input.wallet.address, rulebook });
  const signature = await sendInstructions(input.config.rpcUrl, input.wallet, created.instructions);
  return createMarketReference(client.config, { market: created.market, fixtureId: rulebook.fixtureId, rulebookHash: rulebook.hash, creationSignature: signature });
}

export async function getMobileMarketPosition(input: {
  config: MobileSlipConfiguration;
  reference: MarketReferenceV1;
}): Promise<{ market: MarketSnapshot; tickets: TicketSnapshot[]; wallet: MobileSlipWallet }> {
  await verifyMobileMarketReference(input.config, input.reference);
  const wallet = await loadMobileSlipWallet(input.config);
  const client = createMobileSlipClient(input.config);
  const [market, walletTickets] = await Promise.all([
    client.getMarket(address(input.reference.market)),
    client.listWalletTickets(wallet.address),
  ]);
  return {
    market,
    tickets: walletTickets.filter((ticket) => ticket.market === market.address),
    wallet,
  };
}

export async function claimMobileTicket(input: {
  config: MobileSlipConfiguration;
  reference: MarketReferenceV1;
  wallet: MobileSlipWallet;
  ticket: TicketSnapshot;
  refund: boolean;
}): Promise<string> {
  await verifyMobileMarketReference(input.config, input.reference);
  const client = createMobileSlipClient(input.config);
  const instructions = input.refund
    ? await client.claimRefund({ market: address(input.reference.market), ticket: input.ticket.address, caller: input.wallet.address })
    : await client.claimTicket({ market: address(input.reference.market), ticket: input.ticket.address, caller: input.wallet.address });
  return sendInstructions(input.config.rpcUrl, input.wallet, instructions);
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json() as { result?: T; error?: { code: number; message: string } };
  if (!response.ok || payload.error) throw new Error(`Solana ${method} failed${payload.error ? ` (${payload.error.code}): ${payload.error.message}` : ` with HTTP ${response.status}`}`);
  return payload.result as T;
}

async function sendInstructions(rpcUrl: string, wallet: MobileSlipWallet, instructions: readonly Instruction[]): Promise<string> {
  const latest = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(wallet.address, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.value.blockhash as never, lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  const unsignedBytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  const decoded = getTransactionDecoder().decode(unsignedBytes);
  const signatureBytes = nacl.sign.detached(new Uint8Array(decoded.messageBytes), wallet.secretKey);
  const signed = { ...decoded, signatures: { ...decoded.signatures, [wallet.address]: signatureBytes } } as Parameters<ReturnType<typeof getTransactionEncoder>["encode"]>[0];
  const wire = new Uint8Array(getTransactionEncoder().encode(signed));
  const signature = await rpc<string>(rpcUrl, "sendTransaction", [b4a.toString(wire, "base64"), { encoding: "base64", skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" }]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const statuses = await rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const status = statuses.value[0];
    if (status?.err) throw new Error(`Slip transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Slip transaction ${signature} did not confirm within 90 seconds`);
}
