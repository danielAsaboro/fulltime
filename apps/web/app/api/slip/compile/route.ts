import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
// The upstream enforces its own configured model budget (up to 180 seconds).
// Keep the device proxy slightly wider so it never aborts a still-valid compilation first.
const COMPILER_PROXY_TIMEOUT_MS = 185_000;

export async function POST(request: Request) {
  const origin = process.env.NEXT_PUBLIC_SLIP_COMPILER_ORIGIN?.trim();
  if (!origin) return NextResponse.json({ error: { code: "compiler_unconfigured", message: "Slip Rulebook compiler is not configured." } }, { status: 503 });
  let endpoint: URL;
  try {
    endpoint = new URL("/api/v1/compile", origin);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    return NextResponse.json({ error: { code: "compiler_unconfigured", message: "Slip Rulebook compiler configuration is invalid." } }, { status: 503 });
  }
  const body = await request.text();
  if (!body || Buffer.byteLength(body) > MAX_BODY_BYTES) return NextResponse.json({ error: { code: "invalid_request", message: "Rulebook request is empty or too large." } }, { status: 400 });
  try { JSON.parse(body); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Rulebook request must be JSON." } }, { status: 400 }); }
  try {
    const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(COMPILER_PROXY_TIMEOUT_MS), headers: { "content-type": "application/json", accept: "application/json" }, body });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: { code: "compiler_unavailable", message: cause instanceof Error ? `Slip Rulebook compiler unavailable: ${cause.message}` : "Slip Rulebook compiler unavailable." } }, { status: 502 });
  }
}
