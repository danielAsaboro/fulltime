/**
 * Room radio TTS proxy — ElevenLabs.
 *
 * Consumer key in body (never stored server-side) OR host ELEVENLABS_API_KEY.
 * Roles: booth (room medium) | book (personal).
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 480;
const DEFAULT_MODEL = "eleven_flash_v2_5";

const DEFAULT_VOICES: Record<string, string> = {
  booth: process.env.ELEVENLABS_BOOTH_VOICE_ID?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || "onwK4e9ZLuTAKqWW03F9",
  book: process.env.ELEVENLABS_BOOK_VOICE_ID?.trim() || "Xb7hH8MSUJpSbSDYk0k2",
  // legacy aliases
  commentator: process.env.ELEVENLABS_BOOTH_VOICE_ID?.trim() || "onwK4e9ZLuTAKqWW03F9",
  spectator: process.env.ELEVENLABS_BOOK_VOICE_ID?.trim() || "Xb7hH8MSUJpSbSDYk0k2",
};

type Body = {
  text?: unknown;
  apiKey?: unknown;
  voiceId?: unknown;
  role?: unknown;
  modelId?: unknown;
};

function voiceSettings(role: string) {
  if (role === "book" || role === "spectator") {
    return {
      stability: 0.35,
      similarity_boost: 0.78,
      style: 0.4,
      use_speaker_boost: true,
    };
  }
  // booth / desk
  return {
    stability: 0.52,
    similarity_boost: 0.7,
    style: 0.18,
    use_speaker_boost: true,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `text max ${MAX_CHARS} chars` }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role : "booth";
  const consumerKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const hostKey = process.env.ELEVENLABS_API_KEY?.trim() || "";
  const apiKey = consumerKey || hostKey;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "No ElevenLabs API key — paste yours in FullTime settings, or set ELEVENLABS_API_KEY on the host",
        fallback: true,
      },
      { status: 503 },
    );
  }

  const voiceId =
    (typeof body.voiceId === "string" && body.voiceId.trim()) ||
    DEFAULT_VOICES[role] ||
    DEFAULT_VOICES.booth;

  const modelId =
    (typeof body.modelId === "string" && body.modelId.trim()) ||
    process.env.ELEVENLABS_MODEL_ID?.trim() ||
    DEFAULT_MODEL;

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings(role),
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: "ElevenLabs request failed",
        status: upstream.status,
        detail: detail.slice(0, 240),
        fallback: true,
      },
      { status: 502 },
    );
  }

  const audio = await upstream.arrayBuffer();
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  return NextResponse.json({
    provider: "elevenlabs",
    mode: "room-radio",
    hostKeyConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    voices: {
      booth: DEFAULT_VOICES.booth,
      book: DEFAULT_VOICES.book,
    },
    note: "Room radio: booth + your book. Consumer key in settings, or host ELEVENLABS_API_KEY for builder demos.",
  });
}
