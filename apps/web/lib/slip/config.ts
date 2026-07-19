import { address } from "@solana/kit";
import { createSlipClient, type SlipNetwork } from "@mutinylabs/slip";

export interface SlipBrowserConfiguration {
  network: SlipNetwork;
  rpcUrl: string;
  websocketUrl?: string;
  program: string;
  mint: string;
  compilerOrigin: string;
}

export function slipBrowserConfiguration(): SlipBrowserConfiguration | null {
  const configuredRpcUrl = process.env.NEXT_PUBLIC_SLIP_RPC_URL?.trim();
  const program = process.env.NEXT_PUBLIC_SLIP_PROGRAM_ID?.trim();
  const mint = process.env.NEXT_PUBLIC_SLIP_SETTLEMENT_MINT?.trim();
  const compilerOrigin = process.env.NEXT_PUBLIC_SLIP_COMPILER_ORIGIN?.trim();
  const network = process.env.NEXT_PUBLIC_SLIP_NETWORK?.trim() || "localnet";
  if (!configuredRpcUrl || !program || !mint || !compilerOrigin) return null;
  if (network !== "localnet" && network !== "devnet" && network !== "mainnet-beta") return null;
  try {
    address(program);
    address(mint);
    const rpcUrl = typeof window === "undefined"
      ? configuredRpcUrl
      : new URL("/api/slip/rpc", window.location.origin).toString();
    return { network, rpcUrl, program, mint, compilerOrigin, websocketUrl: process.env.NEXT_PUBLIC_SLIP_WEBSOCKET_URL?.trim() || undefined };
  } catch { return null; }
}

export function createFullTimeSlipClient() {
  const config = slipBrowserConfiguration();
  if (!config) throw new Error("Slip markets need RPC, program, settlement mint, compiler origin, and network configuration");
  return createSlipClient({
    network: config.network,
    rpcUrl: config.rpcUrl,
    websocketUrl: config.websocketUrl,
    programAddress: address(config.program),
    settlementMint: address(config.mint),
    compilerOrigin: config.compilerOrigin,
  });
}

export function isNormalFinancialBrowser(): boolean {
  if (typeof window === "undefined" || window.fullTimePeers) return false;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
