import { NextResponse } from "next/server";
import http from "node:http";
import https from "node:https";

const MAX_RPC_BODY_BYTES = 2 * 1024 * 1024;
let upstreamLane: Promise<void> = Promise.resolve();

function postRpc(target: URL, body: string): Promise<{ status: number; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const rpcRequest = transport.request(target, {
      method: "POST",
      agent: false,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" },
    }, (rpcResponse) => {
      const chunks: Buffer[] = [];
      let size = 0;
      rpcResponse.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RPC_BODY_BYTES) rpcResponse.destroy(new Error("Slip RPC response exceeded 2 MiB"));
        else chunks.push(chunk);
      });
      rpcResponse.once("end", () => resolve({
        status: rpcResponse.statusCode || 502,
        contentType: rpcResponse.headers["content-type"] || "application/json",
        body: Buffer.concat(chunks),
      }));
    });
    rpcRequest.once("error", reject);
    rpcRequest.setTimeout(30_000, () => rpcRequest.destroy(new Error("Slip RPC request timed out")));
    rpcRequest.end(body);
  });
}

export async function POST(request: Request) {
  const upstream = process.env.NEXT_PUBLIC_SLIP_RPC_URL?.trim();
  if (!upstream) {
    return NextResponse.json({ error: { code: "rpc_unconfigured", message: "Slip RPC is not configured" } }, { status: 503 });
  }
  let target: URL;
  try {
    target = new URL(upstream);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    return NextResponse.json({ error: { code: "rpc_unconfigured", message: "Slip RPC configuration is invalid" } }, { status: 503 });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_RPC_BODY_BYTES) {
    return NextResponse.json({ error: { code: "rpc_request_too_large", message: "Solana RPC request is too large" } }, { status: 413 });
  }
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object") throw new Error("invalid payload");
  } catch {
    return NextResponse.json({ error: { code: "invalid_rpc_request", message: "Solana RPC request must be JSON" } }, { status: 400 });
  }
  try {
    const previous = upstreamLane;
    let releaseLane!: () => void;
    const current = new Promise<void>((resolve) => { releaseLane = resolve; });
    upstreamLane = previous.then(() => current);
    await previous;
    try {
      const response = await postRpc(target, body);
      return new Response(response.body.toString("utf8"), {
        status: response.status,
        headers: { "content-type": response.contentType, "cache-control": "no-store" },
      });
    } finally {
      releaseLane();
    }
  } catch (cause) {
    return NextResponse.json({
      error: {
        code: "rpc_unavailable",
        message: cause instanceof Error ? `Slip RPC unavailable: ${cause.message}` : "Slip RPC unavailable",
      },
    }, { status: 502 });
  }
}
