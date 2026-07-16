/**
 * Consumer room radio — ElevenLabs.
 *
 * User may paste their own API key (device-local). Host ELEVENLABS_API_KEY
 * (builder .env.local) is a fallback via /api/tts. Roles:
 *   booth — ambient room medium
 *   book  — personal "your book" lines
 */

export type VoiceRole = "booth" | "book";

const KEY_STORAGE = "fulltime.elevenlabs.apiKey";
const ENABLED_STORAGE = "fulltime.room-radio.enabled";
const LEGACY_CALLOUTS = "fulltime.match-callouts";
const STYLE_STORAGE = "fulltime.room-radio.style"; // desk | bench

/** Ballhard defaults; overridable per role in settings. */
export const DEFAULT_VOICES: Record<VoiceRole, string> = {
  booth: "onwK4e9ZLuTAKqWW03F9", // Embezzler / desk
  book: "Xb7hH8MSUJpSbSDYk0k2", // Margot / personal
};

const VOICE_STORAGE: Record<VoiceRole, string> = {
  booth: "fulltime.elevenlabs.voice.booth",
  book: "fulltime.elevenlabs.voice.book",
};

const audioCache = new Map<string, string>();
let queue: Promise<void> = Promise.resolve();
let activeAudio: HTMLAudioElement | null = null;

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value == null || value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function getElevenLabsApiKey(): string | null {
  const v = read(KEY_STORAGE)?.trim();
  return v || null;
}

export function setElevenLabsApiKey(key: string | null): void {
  write(KEY_STORAGE, key?.trim() || null);
}

export function isRoomRadioEnabled(): boolean {
  return read(ENABLED_STORAGE) === "1" || read(LEGACY_CALLOUTS) === "1";
}

export function setRoomRadioEnabled(on: boolean): void {
  write(ENABLED_STORAGE, on ? "1" : "0");
  write(LEGACY_CALLOUTS, on ? "1" : "0");
  if (!on) cancelRoomRadio();
}

/** @deprecated alias */
export const isMatchVoiceEnabled = isRoomRadioEnabled;
/** @deprecated alias */
export const setMatchVoiceEnabled = setRoomRadioEnabled;
/** @deprecated alias */
export const cancelMatchVoice = cancelRoomRadio;

export function getHouseStyle(): "desk" | "bench" {
  return read(STYLE_STORAGE) === "bench" ? "bench" : "desk";
}

export function setHouseStyle(style: "desk" | "bench"): void {
  write(STYLE_STORAGE, style);
}

export function getVoiceId(role: VoiceRole): string {
  return read(VOICE_STORAGE[role])?.trim() || DEFAULT_VOICES[role];
}

export function setVoiceId(role: VoiceRole, voiceId: string): void {
  write(VOICE_STORAGE[role], voiceId.trim() || DEFAULT_VOICES[role]);
}

export function hasConsumerElevenLabs(): boolean {
  return Boolean(getElevenLabsApiKey());
}

export function cancelRoomRadio(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
}

function speakBrowser(text: string, role: VoiceRole): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = role === "book" ? 1.08 : 1.0;
    utter.pitch = role === "book" ? 1.05 : 1;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    activeAudio = audio;
    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      resolve();
    };
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      reject(new Error("audio play failed"));
    };
    void audio.play().catch(reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function synthesize(text: string, role: VoiceRole): Promise<string | null> {
  const apiKey = getElevenLabsApiKey();
  const voiceId = getVoiceId(role);
  const cacheKey = `${role}:${voiceId}:${text}:${apiKey ? "c" : "h"}`;
  const hit = audioCache.get(cacheKey);
  if (hit) return hit;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId,
      apiKey: apiKey || undefined,
      role,
    }),
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  audioCache.set(cacheKey, url);
  return url;
}

export async function playVoiceClip(text: string, role: VoiceRole): Promise<void> {
  try {
    const url = await synthesize(text, role);
    if (url) {
      await playUrl(url);
      return;
    }
  } catch {
    /* fall through */
  }
  await speakBrowser(text, role);
}

export type QueueClip = { role: VoiceRole; text: string; gapAfterMs: number };

export function enqueueRoomRadio(clips: readonly QueueClip[]): void {
  if (!isRoomRadioEnabled() || clips.length === 0) return;
  queue = queue.then(async () => {
    for (const clip of clips) {
      if (!isRoomRadioEnabled()) return;
      await playVoiceClip(clip.text, clip.role);
      if (clip.gapAfterMs > 0) await sleep(clip.gapAfterMs);
    }
  });
}

/** @deprecated */
export const enqueueMatchVoice = enqueueRoomRadio;

export async function pregenerateVoicePack(
  items: readonly { role: VoiceRole; text: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const total = items.length;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    try {
      const url = await synthesize(item.text, item.role);
      if (url) ok += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
    onProgress?.(i + 1, total);
  }
  return { ok, failed };
}

export async function testElevenLabsKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Room radio is live. This booth stays ambient.",
      apiKey: apiKey.trim(),
      voiceId: DEFAULT_VOICES.booth,
      role: "booth",
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
    return { ok: false, error: body?.detail || body?.error || `HTTP ${res.status}` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    await playUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  return { ok: true };
}

/** Probe host key without consumer key (builder path). */
export async function hostVoiceConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/tts");
    const data = (await res.json()) as { hostKeyConfigured?: boolean };
    return Boolean(data.hostKeyConfigured);
  } catch {
    return false;
  }
}
