/** Deterministic call templates derived only from signed match events. */

import type { Call, CallOption } from "./calls";
import type { MatchEvent } from "./events";
import { asCallId } from "./ids";
import type { FeedTimestamp } from "./time";

const YES_NO: CallOption[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

const NEXT_GOAL: CallOption[] = [
  { id: "home", label: "Home" },
  { id: "away", label: "Away" },
  { id: "neither", label: "Neither" },
];

/**
 * Generate calls exactly once per canonical event. IDs are content-derived, so a
 * recorder replay and a live ingest produce identical calls.
 */
export function callsForEvent(event: MatchEvent): Call[] {
  if (event.kind === "kickoff") {
    return [
      windowCall(event, "opening-goal", "A goal in the next 10 minutes?", "goal", 10),
      nextGoalCall(event, "first-goal", "Who scores first?", 45),
    ];
  }
  if (event.kind === "half-time") {
    return [
      windowCall(event, "second-half-fast-start", "A goal in the first 10 minutes after the break?", "goal", 10),
      nextGoalCall(event, "next-goal-second-half", "Who scores next?", 55),
    ];
  }
  if (["goal", "own-goal", "penalty-scored"].includes(event.kind)) {
    return [windowCall(event, "another-goal", "Another goal in the next 10 minutes?", "goal", 10)];
  }
  if (event.kind === "red-card") {
    return [windowCall(event, "post-red-goal", "A goal in the next 10 minutes?", "goal", 10)];
  }
  return [];
}

function windowCall(
  event: MatchEvent,
  suffix: string,
  prompt: string,
  kind: "goal" | "card" | "corner" | "shot-on-target",
  minutes: number,
): Call {
  return {
    id: asCallId(`call:${event.id}:${suffix}`),
    fixtureId: event.fixtureId,
    roomId: null,
    template: "window",
    spec: { kind: "window", event: kind, withinMinutes: minutes },
    prompt,
    options: YES_NO.map((option) => ({ ...option })),
    openedAt: event.feedTs,
    locksAt: addSeconds(event.feedTs, 30),
    settlesBy: addMinutes(event.feedTs, minutes),
    scored: true,
    status: "open",
    difficulty: null,
  };
}

function nextGoalCall(event: MatchEvent, suffix: string, prompt: string, minutes: number): Call {
  return {
    id: asCallId(`call:${event.id}:${suffix}`),
    fixtureId: event.fixtureId,
    roomId: null,
    template: "next-event",
    spec: { kind: "next-event", event: "goal" },
    prompt,
    options: NEXT_GOAL.map((option) => ({ ...option })),
    openedAt: event.feedTs,
    locksAt: addSeconds(event.feedTs, 30),
    settlesBy: addMinutes(event.feedTs, minutes),
    scored: true,
    status: "open",
    difficulty: null,
  };
}

function addSeconds(feedTs: FeedTimestamp, seconds: number): FeedTimestamp {
  return (feedTs + seconds * 1_000) as FeedTimestamp;
}

function addMinutes(feedTs: FeedTimestamp, minutes: number): FeedTimestamp {
  return addSeconds(feedTs, minutes * 60);
}
