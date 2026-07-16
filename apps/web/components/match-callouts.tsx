"use client";

/**
 * Spoiler-safe spoken call-outs (FanField Angel / FullTime TTS stretch).
 * Speaks only after MatchSync has released an event into the visible timeline.
 * Never reads unreleased feed facts. Toggle persists in localStorage.
 */

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MatchEvent } from "@fulltime/shared";

const STORAGE_KEY = "fulltime.match-callouts";

function speakable(event: MatchEvent, home: string, away: string): string | null {
  const side = event.side === "home" ? home : event.side === "away" ? away : "";
  const minute = event.minute != null ? ` at ${event.minute} minutes` : "";
  switch (event.kind) {
    case "goal":
    case "penalty-scored":
      return `${side || "A"} goal${minute}${event.score ? `. Score ${event.score.home} ${event.score.away}` : ""}`;
    case "own-goal":
      return `Own goal${minute}`;
    case "red-card":
    case "second-yellow":
      return `Red card${side ? ` for ${side}` : ""}${minute}`;
    case "half-time":
      return "Half time";
    case "full-time":
      return event.score ? `Full time. ${event.score.home} to ${event.score.away}` : "Full time";
    case "kickoff":
      return "Kickoff";
    default:
      return null;
  }
}

export function MatchCalloutToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-pressed={enabled}
      title={enabled ? "Mute match call-outs" : "Enable spoiler-safe call-outs"}
    >
      {enabled ? <Volume2 className="size-3.5" aria-hidden /> : <VolumeX className="size-3.5" aria-hidden />}
      <span className="hidden sm:inline">{enabled ? "Call-outs on" : "Call-outs"}</span>
    </button>
  );
}

export function useMatchCallouts(
  timeline: readonly MatchEvent[],
  homeName: string,
  awayName: string,
): void {
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    let enabled = false;
    try {
      enabled = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return;
    }
    if (!enabled) return;

    // Prime: mark existing events so we only speak newly released ones
    if (!primed.current) {
      for (const event of timeline) seen.current.add(String(event.id));
      primed.current = true;
      return;
    }

    for (const event of timeline) {
      const id = String(event.id);
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      const line = speakable(event, homeName, awayName);
      if (!line) continue;
      const utter = new SpeechSynthesisUtterance(line);
      utter.rate = 1.05;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    }
  }, [timeline, homeName, awayName]);
}
