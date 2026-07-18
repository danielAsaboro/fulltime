import { NextResponse } from "next/server";

import { loadLinkPreview } from "@/lib/link-preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("url") ?? "";
  if (!value || value.length > 2_048) return NextResponse.json({ error: "A valid external URL is required." }, { status: 400 });
  try {
    return NextResponse.json(await loadLinkPreview(value), { headers: { "cache-control": "private, max-age=300, stale-while-revalidate=3600" } });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Link preview is unavailable." }, { status: 422 });
  }
}
