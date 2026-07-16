"use client";

/**
 * Room radio — ambient booth for the social second screen.
 *
 * Speaks only from already-visible room state (released timeline, Market Says,
 * your stands, streak). Not stadium PA. Product claim: hands-free room medium
 * while you watch; spoiler discipline is the hard rule, not the narrative.
 */

import { Radio, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  boothClipsForReleasedEvent,
  boothClipsForRoomMoment,
  catchMeUpClips,
  projectCallStreak,
  type HouseStyle,
  type MatchEvent,
  type MarketSaysCard,
} from "@fulltime/shared";

import type { RoomCallView, RoomLiveState, RoomReceiptView } from "@/lib/data";
import {
  cancelRoomRadio,
  enqueueRoomRadio,
  getHouseStyle,
  hasConsumerElevenLabs,
  hostVoiceConfigured,
  isRoomRadioEnabled,
  setRoomRadioEnabled,
} from "@/lib/elevenlabs-consumer";

export function MatchCalloutToggle({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState(() =>
    typeof window !== "undefined" ? isRoomRadioEnabled() : false,
  );
  const [premium, setPremium] = useState(() =>
    typeof window !== "undefined" ? hasConsumerElevenLabs() : false,
  );

  useEffect(() => {
    void hostVoiceConfigured().then((ok) => {
      if (ok || hasConsumerElevenLabs()) setPremium(true);
    });
    const onStorage = () => {
      setEnabled(isRoomRadioEnabled());
      setPremium(hasConsumerElevenLabs());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("fulltime-voice-settings", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("fulltime-voice-settings", onStorage);
    };
  }, []);

  const toggle = () => {
    setEnabled((prev) => {
      const next = !prev;
      setRoomRadioEnabled(next);
      if (!next) cancelRoomRadio();
      window.dispatchEvent(new Event("fulltime-voice-settings"));
      return next;
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-pressed={enabled}
      title={
        enabled
          ? "Mute room radio"
          : premium
            ? "Enable room radio (booth + your book)"
            : "Enable room radio — add ElevenLabs key in settings for premium booth"
      }
    >
      {enabled ? <Radio className="size-3.5" aria-hidden /> : <VolumeX className="size-3.5" aria-hidden />}
      <span className="hidden sm:inline">{enabled ? "Room radio" : "Room radio"}</span>
    </button>
  );
}

function openStandsCount(calls: readonly RoomCallView[]): number {
  return calls.filter((c) => c.status === "open" && c.total > 0).length;
}

function personalFromState(
  calls: readonly RoomCallView[],
  receipts: readonly RoomReceiptView[],
): ReleasedEventVoicePersonal {
  const openMine = calls.filter((c) => c.status === "open" && c.myAnswer);
  const hasOpenStand = openMine.length > 0;
  const standLabel = openMine[0]?.myAnswer
    ? openMine[0]!.call.options.find((o) => o.id === openMine[0]!.myAnswer!.optionId)?.label ??
      openMine[0]!.call.prompt
    : null;

  const outcomes = receipts.map((r) => r.outcome).filter(Boolean) as Array<
    "correct" | "incorrect" | "void" | "accepted"
  >;
  // newest-last for streak
  const streak = projectCallStreak(outcomes.slice().reverse());

  return {
    hasOpenStand,
    standLabel: standLabel ? String(standLabel) : null,
    underPressure: false,
    youreUpIfHolds: false,
    streakLength: streak.current,
    streakAtRisk: streak.current >= 2 && hasOpenStand,
  };
}

type ReleasedEventVoicePersonal = {
  hasOpenStand: boolean;
  standLabel: string | null;
  underPressure: boolean;
  youreUpIfHolds: boolean;
  streakLength: number;
  streakAtRisk: boolean;
};

function majorityFromCalls(calls: readonly RoomCallView[]): { side: string | null; share: number | null } {
  const open = calls.filter((c) => c.status === "open" && c.total > 0);
  if (!open.length) return { side: null, share: null };
  const call = open[open.length - 1]!;
  let bestLabel: string | null = null;
  let best = 0;
  for (const opt of call.call.options) {
    const n = Number(call.tally[opt.id] ?? 0);
    if (n > best) {
      best = n;
      bestLabel = opt.label;
    }
  }
  if (!bestLabel || !call.total) return { side: null, share: null };
  return { side: bestLabel, share: best / call.total };
}

function marketForEvent(event: MatchEvent, marketSays: readonly MarketSaysCard[]): MarketSaysCard | null {
  const byEvidence = marketSays.find((m) => m.evidence?.precedingEventId === event.id);
  if (byEvidence) return byEvidence;
  // nearest card after event feed time
  const after = marketSays.filter((m) => Number(m.feedTs) >= Number(event.feedTs));
  return after[0] ?? marketSays[marketSays.length - 1] ?? null;
}

/**
 * Full room-radio brain: catch-me-up once, then booth/book on room + pitch signals.
 */
export function useRoomRadio(roomId: string, state: RoomLiveState): void {
  const seenEvents = useRef<Set<string>>(new Set());
  const seenMarkets = useRef<Set<string>>(new Set());
  const seenAnswers = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const catchUpDone = useRef<string | null>(null);
  const prevStreak = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isRoomRadioEnabled()) return;

    const match = state.fixture.fixture;
    const teams = {
      home: match.home.shortName ?? match.home.name,
      away: match.away.shortName ?? match.away.name,
    };
    const style: HouseStyle = getHouseStyle();
    const personal = personalFromState(state.calls, state.receipts);

    // Catch-me-up once per room when radio is on
    if (catchUpDone.current !== roomId) {
      catchUpDone.current = roomId;
      const maj = majorityFromCalls(state.calls);
      const hottest = state.marketSays[state.marketSays.length - 1]?.text ?? null;
      const lastCall = state.calls[state.calls.length - 1];
      const lastBigCall = lastCall
        ? `${lastCall.call.prompt}${lastCall.myAnswer ? " (you answered)" : ""}`
        : null;
      const clips = catchMeUpClips({
        teams,
        phase: state.fixture.phase,
        statusLabel: String(state.fixture.status).replace(/-/g, " "),
        score: state.fixture.score,
        minute: state.fixture.minute,
        majoritySide: maj.side,
        majorityShare: maj.share,
        hottestMarketLine: hottest,
        lastBigCall,
        houseStyle: style,
      });
      // Prime seen sets so we don't re-announce history after catch-up
      for (const e of state.timeline) seenEvents.current.add(String(e.id));
      for (const m of state.marketSays) seenMarkets.current.add(m.id);
      for (const c of state.calls) {
        if (c.myAnswer) seenAnswers.current.add(String(c.myAnswer.answerId ?? c.call.id));
      }
      primed.current = true;
      enqueueRoomRadio(clips);
      prevStreak.current = personal.streakLength;
      return;
    }

    if (!primed.current) {
      for (const e of state.timeline) seenEvents.current.add(String(e.id));
      for (const m of state.marketSays) seenMarkets.current.add(m.id);
      primed.current = true;
      return;
    }

    // New released events → odds-as-drama + your book
    for (const event of state.timeline) {
      const id = String(event.id);
      if (seenEvents.current.has(id)) continue;
      seenEvents.current.add(id);
      const market = marketForEvent(event, state.marketSays);
      const impact =
        event.kind === "goal" ||
        event.kind === "own-goal" ||
        event.kind === "penalty-scored" ||
        event.kind === "red-card" ||
        event.kind === "second-yellow";
      const clips = boothClipsForReleasedEvent({
        event,
        teams,
        market,
        openStandsTouching: openStandsCount(state.calls),
        personal: {
          ...personal,
          underPressure: personal.hasOpenStand && impact,
          youreUpIfHolds: personal.hasOpenStand && (event.kind === "goal" || event.kind === "penalty-scored"),
        },
        houseStyle: style,
      });
      if (clips.length) enqueueRoomRadio(clips);
    }

    // Market Says without needing a new pitch event (room medium)
    for (const card of state.marketSays) {
      if (seenMarkets.current.has(card.id)) continue;
      seenMarkets.current.add(card.id);
      // Skip if we just voiced this as part of an event pair (same second)
      const paired = state.timeline.some(
        (e) => card.evidence?.precedingEventId === e.id && seenEvents.current.has(String(e.id)),
      );
      if (paired) continue;
      enqueueRoomRadio(
        boothClipsForRoomMoment({
          kind: "market-says",
          teams,
          label: card.text,
          houseStyle: style,
        }),
      );
    }

    // Your stand locked
    for (const call of state.calls) {
      if (!call.myAnswer) continue;
      const aid = String(call.myAnswer.answerId ?? `${call.call.id}:mine`);
      if (seenAnswers.current.has(aid)) continue;
      seenAnswers.current.add(aid);
      const label =
        call.call.options.find((o) => o.id === call.myAnswer!.optionId)?.label ?? call.call.prompt;
      enqueueRoomRadio(
        boothClipsForRoomMoment({
          kind: "stand-locked",
          teams,
          label: String(label),
          detail: call.call.prompt,
          personal: true,
          houseStyle: style,
        }),
      );
    }

    // Streak changes (your book)
    if (personal.streakLength < prevStreak.current && prevStreak.current >= 2) {
      enqueueRoomRadio(
        boothClipsForRoomMoment({
          kind: "streak-broken",
          teams,
          label: String(prevStreak.current),
          detail: `was ${prevStreak.current}`,
          personal: true,
        }),
      );
    } else if (personal.streakLength > prevStreak.current && personal.streakLength >= 3) {
      enqueueRoomRadio(
        boothClipsForRoomMoment({
          kind: "streak-extended",
          teams,
          label: String(personal.streakLength),
          personal: true,
        }),
      );
    }
    prevStreak.current = personal.streakLength;
  }, [roomId, state]);
}

/** @deprecated use useRoomRadio — kept so room-view can migrate in one edit */
export function useMatchCallouts(
  timeline: readonly MatchEvent[],
  homeName: string,
  awayName: string,
): void {
  // no-op legacy — real path is useRoomRadio(roomId, state)
  void timeline;
  void homeName;
  void awayName;
}
