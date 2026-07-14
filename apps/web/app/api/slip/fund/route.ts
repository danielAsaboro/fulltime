import fs from "node:fs";
import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { fundDeviceWallet } from "@/lib/slip/server-funding";

export const runtime = "nodejs";

type PlayRuntime = {
  kind: "fulltime-slip-play";
  pid: number;
  mint: string;
  playWallet: { publicKey: string; secretKey: number[] };
  fundingUrl: string;
  fundingToken: string;
};

export async function POST(request: Request) {
  try {
    if (process.env.NEXT_PUBLIC_SLIP_NETWORK !== "localnet") throw new Error("The FullTime play wallet is available only on localnet");
    const runtimePath = process.env.SLIP_PLAY_RUNTIME_PATH?.trim();
    if (!runtimePath) throw new Error("SLIP_PLAY_RUNTIME_PATH is not configured");
    const stat = fs.statSync(runtimePath);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("The play-wallet runtime record must be a private file");
    const value = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as PlayRuntime;
    if (value.kind !== "fulltime-slip-play" || !Number.isSafeInteger(value.pid) || value.pid < 1 ||
        typeof value.mint !== "string" || typeof value.playWallet?.publicKey !== "string" || !Array.isArray(value.playWallet?.secretKey) || value.playWallet.secretKey.length !== 64) {
      throw new Error("The play-wallet runtime record is invalid");
    }
    process.kill(value.pid, 0);
    const body = await request.json().catch(() => null) as { publicKey?: unknown } | null;
    if (typeof body?.publicKey === "string") {
      const publicKey = address(body.publicKey);
      const fundingRpcUrl = process.env.SLIP_DEVICE_FUNDING_RPC_URL?.trim();
      if (fundingRpcUrl) {
        return NextResponse.json(await fundDeviceWallet({
          rpcUrl: fundingRpcUrl,
          mint: address(value.mint),
          fundingSecretKey: value.playWallet.secretKey,
          recipient: publicKey,
        }), { headers: { "cache-control": "no-store" } });
      }
      if (typeof value.fundingUrl !== "string" || typeof value.fundingToken !== "string") throw new Error("The play runtime does not expose device funding");
      const funded = await fetch(value.fundingUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${value.fundingToken}` },
        body: JSON.stringify({ publicKey }),
      });
      const payload = await funded.json().catch(() => null) as object | null;
      if (!funded.ok) throw new Error(`Device wallet funding failed with HTTP ${funded.status}`);
      return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ ...value.playWallet, solLamports: 5_000_000_000, tokenUnits: 1_000_000_000 }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status: 503 });
  }
}
