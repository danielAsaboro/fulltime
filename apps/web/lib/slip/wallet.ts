import { getWallets } from "@wallet-standard/app";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  createSignerFromKeyPair,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Instruction,
} from "@solana/kit";

interface WalletAccount { address: string; chains: readonly string[]; features: readonly string[] }
interface Wallet {
  name: string;
  accounts: readonly WalletAccount[];
  features: Record<string, unknown>;
}
type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> };
type SignTransactionFeature = { signTransaction(...inputs: Array<{ account: WalletAccount; chain: string; transaction: Uint8Array }>): Promise<Array<{ signedTransaction: Uint8Array }>> };

export interface ConnectedSlipWallet {
  name: string;
  address: Address;
  chain: string;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}

const PLAY_WALLET_VERSION = 1;

type StoredPlayWallet = {
  version: typeof PLAY_WALLET_VERSION;
  address: string;
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
};

async function loadPlaySigner(network: string) {
  const storageKey = `fulltime:slip-play-wallet:${network}`;
  const funding = await fetch("/api/slip/fund", { method: "POST" });
  const fundingBody = await funding.json().catch(() => null) as { publicKey?: string; secretKey?: number[]; error?: string } | null;
  if (!funding.ok) throw new Error(fundingBody?.error || `Play wallet funding failed with HTTP ${funding.status}`);
  if (!fundingBody?.publicKey || !Array.isArray(fundingBody.secretKey) || fundingBody.secretKey.length !== 64) {
    throw new Error("The local play runtime returned invalid wallet material");
  }
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as StoredPlayWallet;
      if (parsed.version !== PLAY_WALLET_VERSION || parsed.address !== fundingBody.publicKey) throw new Error("stale play wallet");
      const keyPair = {
        privateKey: await crypto.subtle.importKey("jwk", parsed.privateKey, { name: "Ed25519" }, true, ["sign"]),
        publicKey: await crypto.subtle.importKey("jwk", parsed.publicKey, { name: "Ed25519" }, true, ["verify"]),
      };
      return createSignerFromKeyPair(keyPair);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(fundingBody.secretKey), true);
  const serialized: StoredPlayWallet = {
    version: PLAY_WALLET_VERSION,
    address: signer.address,
    privateKey: await crypto.subtle.exportKey("jwk", signer.keyPair.privateKey),
    publicKey: await crypto.subtle.exportKey("jwk", signer.keyPair.publicKey),
  };
  localStorage.setItem(storageKey, JSON.stringify(serialized));
  return signer;
}

export async function connectPlayWallet(network: "localnet" | "devnet" | "mainnet-beta"): Promise<ConnectedSlipWallet> {
  if (network !== "localnet") return connectSlipWallet(network);
  const signer = await loadPlaySigner(network);
  return {
    name: "FullTime play wallet",
    address: signer.address,
    chain: "solana:devnet",
    signTransaction: async (transaction) => {
      const decoded = getTransactionDecoder().decode(transaction);
      const signed = await signTransaction([signer.keyPair], decoded);
      return new Uint8Array(getTransactionEncoder().encode(signed));
    },
  };
}

export async function connectSlipWallet(network: "localnet" | "devnet" | "mainnet-beta"): Promise<ConnectedSlipWallet> {
  const chain = network === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";
  const wallet = getWallets().get().find((candidate) => "standard:connect" in candidate.features && "solana:signTransaction" in candidate.features && candidate.chains.includes(chain)) as Wallet | undefined;
  if (!wallet) throw new Error(`No installed Wallet Standard wallet supports ${chain} transaction signing`);
  const connect = wallet.features["standard:connect"] as ConnectFeature;
  const result = await connect.connect();
  const account = result.accounts.find((candidate) => candidate.chains.includes(chain) && candidate.features.includes("solana:signTransaction"));
  if (!account) throw new Error(`${wallet.name} did not expose a ${chain} signing account`);
  return {
    name: wallet.name,
    address: address(account.address),
    chain,
    signTransaction: async (transaction) => {
      const feature = wallet.features["solana:signTransaction"] as SignTransactionFeature;
      const [signed] = await feature.signTransaction({ account, chain, transaction });
      if (!signed?.signedTransaction) throw new Error(`${wallet.name} did not return a signed transaction`);
      return signed.signedTransaction;
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json() as { result?: T; error?: { code: number; message: string } };
  if (!response.ok || body.error) throw new Error(`Solana ${method} failed${body.error ? ` (${body.error.code}): ${body.error.message}` : ` with HTTP ${response.status}`}`);
  return body.result as T;
}

export async function sendSlipInstructions(input: { wallet: ConnectedSlipWallet; rpcUrl: string; instructions: readonly Instruction[] }): Promise<string> {
  if (!input.instructions.length) throw new Error("Slip produced no transaction instructions");
  const latest = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(input.rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(input.wallet.address, value),
    (value) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.value.blockhash as never, lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) }, value),
    (value) => appendTransactionMessageInstructions(input.instructions, value),
  );
  const transaction = getTransactionEncoder().encode(compileTransaction(message));
  const signedTransaction = await input.wallet.signTransaction(new Uint8Array(transaction));
  const signature = await rpc<string>(input.rpcUrl, "sendTransaction", [bytesToBase64(signedTransaction), { encoding: "base64", skipPreflight: false, maxRetries: 3, preflightCommitment: "confirmed" }]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const statuses = await rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(input.rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const status = statuses.value[0];
    if (status?.err) throw new Error(`Slip transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 750));
  }
  throw new Error(`Slip transaction ${signature} was sent but did not confirm within 90 seconds`);
}
