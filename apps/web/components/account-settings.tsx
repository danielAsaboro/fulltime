"use client";

import { Settings, X } from "lucide-react";
import { useState } from "react";
import { voicePackTemplates } from "@fulltime/shared";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";
import {
  getElevenLabsApiKey,
  getHouseStyle,
  getVoiceId,
  hasConsumerElevenLabs,
  hostVoiceConfigured,
  isRoomRadioEnabled,
  pregenerateVoicePack,
  setElevenLabsApiKey,
  setHouseStyle,
  setRoomRadioEnabled,
  setVoiceId,
  testElevenLabsKey,
  type VoiceRole,
} from "@/lib/elevenlabs-consumer";

function notifyVoiceSettings() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("fulltime-voice-settings"));
  }
}

export function AccountSettingsButton() {
  const { session, signIn, signOut } = useData();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [radioOn, setRadioOn] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [hostKey, setHostKey] = useState(false);
  const [packStatus, setPackStatus] = useState<string | null>(null);
  const [boothVoice, setBoothVoice] = useState("");
  const [bookVoice, setBookVoice] = useState("");
  const [style, setStyle] = useState<"desk" | "bench">("desk");
  const resetAvailable = typeof window !== "undefined" && typeof window.fullTimePeers?.resetIdentity === "function";

  const openSettings = () => {
    setName(session?.displayName ?? "");
    setApiKey(getElevenLabsApiKey() ?? "");
    setKeySaved(hasConsumerElevenLabs());
    setRadioOn(isRoomRadioEnabled());
    setHasKey(hasConsumerElevenLabs());
    setBoothVoice(getVoiceId("booth"));
    setBookVoice(getVoiceId("book"));
    setStyle(getHouseStyle());
    setPackStatus(null);
    setError(null);
    setOpen(true);
    void hostVoiceConfigured().then(setHostKey);
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account settings could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const saveKey = () =>
    void run(async () => {
      const trimmed = apiKey.trim();
      if (!trimmed) {
        setElevenLabsApiKey(null);
        setKeySaved(false);
        setHasKey(false);
        notifyVoiceSettings();
        return;
      }
      const result = await testElevenLabsKey(trimmed);
      if (!result.ok) throw new Error(result.error);
      setElevenLabsApiKey(trimmed);
      setKeySaved(true);
      setHasKey(true);
      notifyVoiceSettings();
    });

  const generatePack = () =>
    void run(async () => {
      setPackStatus("Warming booth + your-book pack…");
      const templates = voicePackTemplates({ home: "Home", away: "Away" });
      const { ok, failed } = await pregenerateVoicePack(templates, (done, total) => {
        setPackStatus(`Generating… ${done}/${total}`);
      });
      setPackStatus(
        failed
          ? `Ready ${ok} clips · ${failed} failed (browser voice fills gaps)`
          : `Ready — ${ok} room-radio clips cached for this session`,
      );
    });

  const persistVoice = (role: VoiceRole, value: string) => {
    setVoiceId(role, value);
    if (role === "booth") setBoothVoice(getVoiceId("booth"));
    else setBookVoice(getVoiceId("book"));
  };

  return (
    <>
      <button
        type="button"
        onClick={openSettings}
        className="grid size-9 place-items-center rounded-full border border-ash hover:border-off-black"
        aria-label="Account settings"
      >
        <Settings className="size-4" />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex justify-end bg-off-black/35"
          role="dialog"
          aria-modal="true"
          aria-label="Account settings"
        >
          <section className="h-full w-full max-w-md overflow-y-auto bg-parchment p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Account</p>
                <h2 className="mt-1 text-heading-sm">Settings</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid size-9 place-items-center" aria-label="Close settings">
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-8 space-y-7">
              {session ? (
                <>
                  <section>
                    <label className="font-mono text-caption uppercase tracking-[0.1em] text-smoke" htmlFor="account-display-name">
                      Display name
                    </label>
                    <input
                      id="account-display-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={48}
                      className="mt-2 w-full rounded-lg border border-ash bg-white px-4 py-3 outline-none focus:border-off-black"
                    />
                    <Button
                      className="mt-3"
                      size="sm"
                      disabled={busy || !name.trim() || name.trim() === session.displayName}
                      onClick={() => void run(async () => { await signIn(name.trim()); })}
                    >
                      Save name
                    </Button>
                  </section>
                  <section className="border-t border-ash pt-5">
                    <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Account ID</p>
                    <p className="mt-2 break-all font-mono text-caption text-graphite">{session.userId}</p>
                  </section>
                </>
              ) : (
                <p className="text-body-sm text-graphite">Sign in to manage identity. Room radio works without signing in.</p>
              )}

              <section className="border-t border-ash pt-5">
                <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Room radio · ElevenLabs</p>
                <p className="mt-2 text-body-sm text-graphite">
                  This room has a booth — not stadium PA. Ambient lines for stands, polls, market moves, and released events with odds.{" "}
                  <strong>Your book</strong> only speaks things that touch your open stands and Fan IQ streak. Peers still write; voice keeps eyes on the TV.
                </p>

                <label className="mt-4 flex items-center gap-2 font-mono text-caption text-off-black">
                  <input
                    type="checkbox"
                    checked={radioOn}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setRadioOn(on);
                      setRoomRadioEnabled(on);
                      notifyVoiceSettings();
                    }}
                  />
                  Enable room radio in rooms
                </label>

                <div className="mt-3 flex gap-2">
                  {(["desk", "bench"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStyle(s);
                        setHouseStyle(s);
                        notifyVoiceSettings();
                      }}
                      className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                        style === s ? "border-off-black bg-off-black text-white" : "border-ash text-smoke"
                      }`}
                    >
                      {s === "desk" ? "Calm desk" : "Hype bench"}
                    </button>
                  ))}
                </div>

                <label className="mt-4 block font-mono text-caption uppercase tracking-[0.1em] text-smoke" htmlFor="elevenlabs-key">
                  Your ElevenLabs API key (optional)
                </label>
                <input
                  id="elevenlabs-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_…"
                  className="mt-2 w-full rounded-lg border border-ash bg-white px-4 py-3 font-mono text-body-sm outline-none focus:border-off-black"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={saveKey}>
                    {busy ? "Checking…" : "Save & test key"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !apiKey.trim()}
                    onClick={() => {
                      setApiKey("");
                      setElevenLabsApiKey(null);
                      setKeySaved(false);
                      setHasKey(false);
                      notifyVoiceSettings();
                    }}
                  >
                    Clear key
                  </Button>
                </div>
                {keySaved || hasKey ? (
                  <p className="mt-2 font-mono text-caption text-graphite">Consumer key on this device</p>
                ) : hostKey ? (
                  <p className="mt-2 font-mono text-caption text-graphite">Host key live — premium booth ready for demos</p>
                ) : (
                  <p className="mt-2 font-mono text-caption text-smoke">Without a key, room radio uses browser voice for the same scripts</p>
                )}

                <div className="mt-4 grid gap-3">
                  <div>
                    <label className="font-mono text-caption uppercase tracking-[0.1em] text-smoke" htmlFor="voice-booth">
                      Booth voice id
                    </label>
                    <input
                      id="voice-booth"
                      value={boothVoice}
                      onChange={(e) => setBoothVoice(e.target.value)}
                      onBlur={() => persistVoice("booth", boothVoice)}
                      className="mt-1 w-full rounded-lg border border-ash bg-white px-3 py-2 font-mono text-caption outline-none focus:border-off-black"
                    />
                  </div>
                  <div>
                    <label className="font-mono text-caption uppercase tracking-[0.1em] text-smoke" htmlFor="voice-book">
                      Your-book voice id
                    </label>
                    <input
                      id="voice-book"
                      value={bookVoice}
                      onChange={(e) => setBookVoice(e.target.value)}
                      onBlur={() => persistVoice("book", bookVoice)}
                      className="mt-1 w-full rounded-lg border border-ash bg-white px-3 py-2 font-mono text-caption outline-none focus:border-off-black"
                    />
                  </div>
                </div>

                <Button className="mt-4" size="sm" variant="ghost" disabled={busy} onClick={generatePack}>
                  Warm room-radio pack
                </Button>
                {packStatus ? <p className="mt-2 font-mono text-caption text-graphite">{packStatus}</p> : null}
              </section>

              {session ? (
                <section className="border-t border-ash pt-5">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await signOut(); setOpen(false); })}>
                    Sign out
                  </Button>
                </section>
              ) : null}

              {resetAvailable ? (
                <section className="border-t border-crimson/30 pt-5">
                  <p className="font-mono text-caption uppercase tracking-[0.1em] text-crimson">Danger zone</p>
                  <p className="mt-2 text-body-sm text-graphite">Archives this device’s peer store and restarts FullTime with a new identity.</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 border-crimson text-crimson"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Reset this device account? The current peer store will be archived and FullTime will restart with a new identity.")) {
                        void run(() => window.fullTimePeers!.resetIdentity!());
                      }
                    }}
                  >
                    Reset account
                  </Button>
                </section>
              ) : null}

              {error ? (
                <p className="font-mono text-caption text-crimson" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
