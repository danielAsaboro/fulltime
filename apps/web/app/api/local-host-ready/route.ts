export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private launcher handshake; the random token exists only in the desktop child environment. */
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.FULLTIME_LOCAL_UPSTREAM_TOKEN;
  const supplied = request.headers.get("x-fulltime-upstream-token");
  if (!expected || !supplied || supplied.length !== expected.length || !constantTimeEqual(supplied, expected)) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}
import { timingSafeEqual } from "node:crypto";
