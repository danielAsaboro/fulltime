/**
 * Mobile room radio — consumer or builder ElevenLabs key in SecureStore.
 * Roles: booth (room medium) + book (personal).
 */

import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";

import type { VoiceClip, VoiceRole } from "./match-voice";

const KEY_STORE = "fulltime.elevenlabs.apiKey.v1";
const ENABLED_STORE = "fulltime.room-radio.enabled.v1";
const VOICE_BOOTH = "fulltime.elevenlabs.voice.booth.v1";
const VOICE_BOOK = "fulltime.elevenlabs.voice.book.v1";

/** Ballhard booth / book defaults */
export const DEFAULT_VOICES: Record<VoiceRole, string> = {
  booth: "onwK4e9ZLuTAKqWW03F9",
  book: "Xb7hH8MSUJpSbSDYk0k2",
};

let queue: Promise<void> = Promise.resolve();
let voiceEnabledMemory = false;
let apiKeyMemory: string | null = null;

function hashText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(binary);
}

export async function loadMatchVoicePrefs(): Promise<{ enabled: boolean; apiKey: string | null }> {
  const [enabled, apiKey] = await Promise.all([
    SecureStore.getItemAsync(ENABLED_STORE),
    SecureStore.getItemAsync(KEY_STORE),
  ]);
  voiceEnabledMemory = enabled === "1";
  apiKeyMemory = apiKey?.trim() || null;
  return { enabled: voiceEnabledMemory, apiKey: apiKeyMemory };
}

export async function setMatchVoiceEnabled(on: boolean): Promise<void> {
  voiceEnabledMemory = on;
  await SecureStore.setItemAsync(ENABLED_STORE, on ? "1" : "0", {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function setElevenLabsApiKey(key: string | null): Promise<void> {
  apiKeyMemory = key?.trim() || null;
  if (!apiKeyMemory) {
    await SecureStore.deleteItemAsync(KEY_STORE);
    return;
  }
  await SecureStore.setItemAsync(KEY_STORE, apiKeyMemory, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function isMatchVoiceEnabledSync(): boolean {
  return voiceEnabledMemory;
}

export function getApiKeySync(): string | null {
  return apiKeyMemory;
}

async function resolveVoiceId(role: VoiceRole): Promise<string> {
  const key = role === "booth" ? VOICE_BOOTH : VOICE_BOOK;
  const stored = await SecureStore.getItemAsync(key);
  return stored?.trim() || DEFAULT_VOICES[role];
}

function voiceSettings(role: VoiceRole) {
  if (role === "book") {
    return { stability: 0.35, similarity_boost: 0.78, style: 0.4, use_speaker_boost: true };
  }
  return { stability: 0.52, similarity_boost: 0.7, style: 0.18, use_speaker_boost: true };
}

async function synthesizeToFile(text: string, role: VoiceRole): Promise<string | null> {
  const apiKey = apiKeyMemory;
  if (!apiKey) return null;
  const voice = await resolveVoiceId(role);
  const dir = FileSystem.cacheDirectory;
  if (!dir) return null;
  const path = `${dir}fulltime-radio-${role}-${hashText(text)}.mp3`;
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) return path;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: voiceSettings(role),
    }),
  });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const b64 = bytesToBase64(new Uint8Array(buf));
  await FileSystem.writeAsStringAsync(path, b64, { encoding: "base64" });
  return path;
}

async function playFile(path: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const av = require("expo-av") as {
      Audio: {
        setAudioModeAsync(mode: object): Promise<void>;
        Sound: {
          createAsync(
            source: { uri: string },
            initial?: object,
          ): Promise<{
            sound: {
              unloadAsync(): Promise<void>;
              setOnPlaybackStatusUpdate(cb: (s: { didJustFinish?: boolean }) => void): void;
            };
          }>;
        };
      };
    };
    await av.Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });
    const { sound } = await av.Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) void sound.unloadAsync().finally(resolve);
      });
      setTimeout(() => {
        void sound.unloadAsync().finally(resolve);
      }, 20_000);
    });
  } catch {
    /* no expo-av */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function testElevenLabsKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: "API key required" };
  apiKeyMemory = trimmed;
  try {
    const path = await synthesizeToFile("Room radio is live. This booth stays ambient.", "booth");
    if (!path) return { ok: false, error: "ElevenLabs rejected the key or network failed." };
    await playFile(path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Voice test failed" };
  }
}

export function enqueueMatchVoice(clips: readonly VoiceClip[]): void {
  if (!voiceEnabledMemory || clips.length === 0) return;
  queue = queue.then(async () => {
    for (const clip of clips) {
      if (!voiceEnabledMemory) return;
      try {
        const path = await synthesizeToFile(clip.text, clip.role);
        if (path) await playFile(path);
      } catch {
        /* continue */
      }
      if (clip.gapAfterMs > 0) await sleep(clip.gapAfterMs);
    }
  });
}
