/**
 * Deterministic France–Morocco scenario. Produces an ordered list of labelled
 * beats — each a full `RoomLiveState` snapshot — that walks every UI state the
 * room must handle: pre-match → kickoff → open call → goal (tallies roll, call
 * settles, receipt lands pending → anchored ✓) → a swallowed-gap VOID → penalty
 * → full time. The mock client plays these; scenarios jump straight to any label.
 */

import {
  asFeedMessageId,
  asFeedTimestamp,
  asFixtureId,
  asMatchEventId,
  type Call,
  type CallOption,
  type CallSpec,
  type MarketSaysCard,
  type MatchEvent,
  type MatchEventKind,
  type Note,
  type Poll,
  type Receipt,
  type Settlement,
  type TeamSide,
} from "@fulltime/shared";

import type {
  CallOutcome,
  CallView,
  FanIqView,
  ReceiptView,
  RoomLiveState,
  TimelineItem,
} from "../types";
import { FM_FIXTURE_ID, FM_KICKOFF_MS } from "./corpus";

const FX = asFixtureId(FM_FIXTURE_ID);
const ROOM_SIZE = 2140;

const at = (minute: number): number => FM_KICKOFF_MS + minute * 60_000;

function ev(
  kind: MatchEventKind,
  minute: number,
  side: TeamSide | null,
  score?: { home: number; away: number },
  detail?: string,
): MatchEvent {
  return {
    id: asMatchEventId(`ev-${kind}-${minute}`),
    fixtureId: FX,
    kind,
    feedTs: asFeedTimestamp(at(minute)),
    messageId: asFeedMessageId(`${FM_FIXTURE_ID}:${minute}`),
    minute,
    side,
    ...(score ? { score } : {}),
    ...(detail ? { detail } : {}),
  };
}

function opts(...pairs: [string, string][]): CallOption[] {
  return pairs.map(([id, label]) => ({ id, label }));
}

function call(
  id: string,
  template: Call["template"],
  spec: CallSpec,
  prompt: string,
  options: CallOption[],
  openMin: number,
  lockMin: number,
  settleMin: number,
  difficulty: number,
): Call {
  return {
    id: `call-${id}` as Call["id"],
    fixtureId: FX,
    roomId: null,
    template,
    spec,
    prompt,
    options,
    openedAt: asFeedTimestamp(at(openMin)),
    locksAt: asFeedTimestamp(at(lockMin)),
    settlesBy: asFeedTimestamp(at(settleMin)),
    scored: true,
    status: "open",
    difficulty,
  };
}

function settlement(callId: string, outcome: CallOutcome, winningOption: string, minute: number): Settlement {
  return {
    id: `stl-${callId}` as Settlement["id"],
    callId: callId as Settlement["callId"],
    outcome:
      outcome === "void"
        ? { status: "void", reason: "feed-gap" }
        : { status: "settled", winningOption },
    settledAtFeedTs: outcome === "void" ? null : asFeedTimestamp(at(minute)),
    decidingMessageIds: [asFeedMessageId(`${FM_FIXTURE_ID}:${minute}`)],
  };
}

function makeMarketSays(id: string, kind: MarketSaysCard["kind"], minute: number, text: string): MarketSaysCard {
  return {
    id: `ms-${id}`,
    fixtureId: FX,
    kind,
    feedTs: asFeedTimestamp(at(minute)),
    text,
    evidence: {},
  };
}

function momentReceipt(
  id: string,
  moment: "goal" | "red-card" | "penalty",
  matchEventId: string,
  state: Receipt["state"],
  minute: number,
  headline: string,
  anchored: boolean,
): ReceiptView {
  const receipt: Receipt = {
    id: `rcpt-${id}` as Receipt["id"],
    fixtureId: FX,
    state,
    subject: { kind: "moment", moment, matchEventId: asMatchEventId(matchEventId) },
    createdAt: at(minute) as Receipt["createdAt"],
    updatedAt: at(minute) as Receipt["updatedAt"],
    ...(anchored
      ? {
          proof: {
            statValidationRef: `0x${id}a17f…proof`,
            anchorRef: `root#${41800 + minute}`,
            anchorUrl: "https://txline.txodds.com",
            verifiedAt: at(minute + 2) as Receipt["createdAt"],
          },
        }
      : {}),
  };
  return {
    receipt,
    headline,
    minute,
    technical: {
      seq: 100 + minute,
      statKey: moment === "goal" ? "1 · Participant_Score" : "penalty",
      ...(anchored
        ? { statValidationRef: `0x${id}a17f…proof`, anchorRef: `root#${41800 + minute}`, anchorUrl: "https://txline.txodds.com" }
        : {}),
    },
  };
}

function callReceipt(
  id: string,
  callId: string,
  outcome: CallOutcome,
  state: Receipt["state"],
  minute: number,
  prompt: string,
  headline: string,
  anchored: boolean,
): ReceiptView {
  const receipt: Receipt = {
    id: `rcpt-${id}` as Receipt["id"],
    fixtureId: FX,
    state,
    subject: {
      kind: "call",
      callId: callId as Call["id"],
      outcome: outcome === "void" ? { status: "void", reason: "feed-gap" } : { status: "settled", winningOption: id },
    },
    createdAt: at(minute) as Receipt["createdAt"],
    updatedAt: at(minute) as Receipt["updatedAt"],
    ...(anchored
      ? { proof: { statValidationRef: `0x${id}proof`, anchorRef: `root#${41800 + minute}`, anchorUrl: "https://txline.txodds.com" } }
      : {}),
  };
  return {
    receipt,
    headline,
    callPrompt: prompt,
    minute,
    technical: {
      seq: 200 + minute,
      statKey: "1 · Participant_Score",
      ...(anchored ? { statValidationRef: `0x${id}proof`, anchorRef: `root#${41800 + minute}`, anchorUrl: "https://txline.txodds.com" } : {}),
    },
  };
}

// --- Calls used across the match ---

const CALL_PICK = call(
  "pick",
  "next-event",
  { kind: "next-event", event: "goal" },
  "Full-time result — who takes it?",
  opts(["fra", "France"], ["draw", "Draw"], ["mar", "Morocco"]),
  -6,
  0,
  90,
  0.46,
);

const CALL_SCORE30 = call(
  "score30",
  "window",
  { kind: "window", event: "goal", withinMinutes: 18, side: "home" },
  "France to score before 30'?",
  opts(["yes", "Yes"], ["no", "No"]),
  12,
  23,
  30,
  0.44,
);

const CALL_NEXTGOAL = call(
  "nextgoal",
  "next-event",
  { kind: "next-event", event: "goal", beforeMinute: 90 },
  "Next goal — France, Morocco, or neither?",
  opts(["fra", "France"], ["mar", "Morocco"], ["none", "Neither"]),
  23,
  40,
  90,
  0.39,
);

const CALL_CORNERS = call(
  "corners",
  "threshold",
  { kind: "threshold", metric: "corners", atLeast: 9, beforeMinute: 80 },
  "Total corners past 8 before 80'?",
  opts(["yes", "Yes"], ["no", "No"]),
  52,
  74,
  80,
  0.55,
);

const REACTS = (goal: number, fire: number, shock: number): TimelineItem["reactions"] => [
  { emoji: "🔥", count: fire },
  { emoji: "⚽", count: goal },
  { emoji: "😱", count: shock },
];

interface Beat {
  label: string;
  state: RoomLiveState;
}

/** Build the full ordered beat list. Pure + deterministic. */
export function buildFraMarBeats(): Beat[] {
  const beats: Beat[] = [];

  const timeline: TimelineItem[] = [];
  const calls = new Map<string, CallView>();
  const receipts: ReceiptView[] = [];
  const marketSays: MarketSaysCard[] = [];
  let polls: Poll[] = [];
  const notes: Note[] = [];
  const fanIq: FanIqView = { fanIq: 0, accuracy: 0, scoredCalls: 0, correctCalls: 0, roomRank: 0, roomSize: ROOM_SIZE };

  const pushEvent = (event: MatchEvent, label: string, reactions?: TimelineItem["reactions"]): void => {
    timeline.unshift({
      id: `tl-${event.id}`,
      feedTs: event.feedTs,
      kind: reactions ? "eruption" : "event",
      label,
      event,
      ...(reactions ? { reactions } : {}),
    });
  };

  const setCall = (c: Call, tally: Record<string, number>, extra: Partial<CallView> = {}): void => {
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    calls.set(c.id, { call: c, tally, total, ...extra });
  };

  const scoreFan = (fanIqAdd: number, correct: boolean): void => {
    fanIq.scoredCalls += 1;
    if (correct) fanIq.correctCalls += 1;
    fanIq.fanIq += fanIqAdd;
    fanIq.accuracy = fanIq.scoredCalls ? fanIq.correctCalls / fanIq.scoredCalls : 0;
    fanIq.roomRank = correct ? Math.max(1, 220 - fanIq.fanIq) : fanIq.roomRank + 40;
  };

  const snapshot = (
    label: string,
    minute: number | null,
    status: RoomLiveState["fixtureState"]["status"],
    score: { home: number; away: number },
    phase: RoomLiveState["phase"],
    crowd: number,
    pressure: number,
    lastEventId: string | null,
    gaps: RoomLiveState["fixtureState"]["gaps"] = [],
  ): void => {
    beats.push({
      label,
      state: {
        fixtureState: {
          fixtureId: FX,
          status,
          minute,
          score,
          lastFeedTs: minute === null ? null : asFeedTimestamp(at(minute)),
          lastMessageId: lastEventId ? asFeedMessageId(`${FM_FIXTURE_ID}:${minute}`) : null,
          gaps,
        },
        phase,
        crowd,
        timeline: [...timeline],
        calls: [...calls.values()],
        marketSays: [...marketSays],
        polls: [...polls],
        notes: [...notes],
        receipts: [...receipts],
        fanIq: { ...fanIq },
        items: [],
        members: [],
        typingUsers: [],
        unreadState: {
          count: 0,
          firstUnreadItemId: null,
          lastReadItemId: null,
          isAtLiveEdge: true,
        },
        pressure,
        lastEventId,
      },
    });
  };

  // 0 — pre-match
  setCall(CALL_PICK, { fra: 1180, draw: 410, mar: 550 }, { myAnswer: "fra" });
  snapshot("prematch", null, "scheduled", { home: 0, away: 0 }, "upcoming", 1290, 0.15, null);

  // 1 — kickoff
  pushEvent(ev("kickoff", 0, null), "Kick-off — France vs Morocco");
  setCall({ ...CALL_PICK, status: "locked" }, { fra: 1180, draw: 410, mar: 550 }, { myAnswer: "fra" });
  snapshot("kickoff", 0, "first-half", { home: 0, away: 0 }, "live", 1720, 0.2, "ev-kickoff-0");

  // 2 — call open + first market read
  pushEvent(ev("corner", 12, "home"), "12' Corner, France");
  setCall(CALL_SCORE30, { yes: 690, no: 360 }, { myAnswer: "yes" });
  marketSays.push(
    marketSays_ ("m1", "pressure-building", 12,
      "France's win chance ticked from 52% to 58% without a goal on the board. The market senses pressure building."),
  );
  snapshot("call-open", 12, "first-half", { home: 0, away: 0 }, "live", 1980, 0.42, "ev-corner-12");

  // 3 — GOAL France, the window call settles correct, receipt pending
  pushEvent(ev("goal", 23, "home", { home: 1, away: 0 }, "Mbappé"), "23' GOAL — France! 1–0", REACTS(940, 1210, 120));
  setCall({ ...CALL_SCORE30, status: "settled" }, { yes: 690, no: 360 }, {
    myAnswer: "yes",
    settlement: settlement("call-score30", "correct", "yes", 23),
    outcome: "correct",
    points: 227,
    receiptId: "rcpt-goal1",
  });
  setCall(CALL_NEXTGOAL, { fra: 300, mar: 560, none: 240 }, { myAnswer: "fra" });
  receipts.unshift(momentReceipt("goal1", "goal", "ev-goal-23", "proof-pending", 23, "France's opener — logged from the feed", false));
  scoreFan(227, true);
  snapshot("goal", 23, "first-half", { home: 1, away: 0 }, "live", 2120, 0.68, "ev-goal-23");

  // 4 — receipt upgrades pending → anchored
  receipts[0] = momentReceipt("goal1", "goal", "ev-goal-23", "anchored", 25, "France's opener — verified against the on-chain root", true);
  marketSays.push(marketSays_("m2", "muted-reaction", 26, "The goal barely moved the price — the market already had France ahead. No panic, no overreaction."));
  polls = [
    {
      id: "poll-pressure" as Poll["id"],
      roomId: "room-fra-mar" as Poll["roomId"],
      question: "Does France look like a team that closes this out?",
      options: [
        { id: "yes", label: "Locked in", votes: 812 },
        { id: "no", label: "Morocco's coming", votes: 640 },
      ],
      scored: false,
      createdAt: at(26) as Poll["createdAt"],
    },
  ];
  snapshot("receipt-anchored", 26, "first-half", { home: 1, away: 0 }, "live", 2200, 0.55, "ev-goal-23");

  // 5 — half-time, then a threshold call in the second half
  pushEvent(ev("half-time", 45, null, { home: 1, away: 0 }), "Half-time — France 1–0 Morocco");
  pushEvent(ev("second-half-start", 46, null, { home: 1, away: 0 }), "46' Second half under way");
  setCall(CALL_CORNERS, { yes: 410, no: 520 }, { myAnswer: "no" });
  notes.push({
    id: "note-1" as Note["id"],
    roomId: "room-fra-mar" as Note["roomId"],
    userId: "u-amina" as Note["userId"],
    text: "Morocco pushing three at the back now — it's coming.",
    anchor: { kind: "minute", minute: 58 },
    feedTs: asFeedTimestamp(at(58)),
    createdAt: at(58) as Note["createdAt"],
  });
  snapshot("second-half", 58, "second-half", { home: 1, away: 0 }, "live", 2260, 0.7, "ev-second-half-start-46");

  // 6 — GOAL Morocco, the "next goal" call settles — the viewer picked France, a miss
  pushEvent(ev("goal", 67, "away", { home: 1, away: 1 }, "Ziyech"), "67' GOAL — Morocco! 1–1", REACTS(1010, 1440, 880));
  setCall({ ...CALL_NEXTGOAL, status: "settled" }, { fra: 300, mar: 560, none: 240 }, {
    myAnswer: "fra",
    settlement: settlement("call-nextgoal", "incorrect", "mar", 67),
    outcome: "incorrect",
    points: 0,
    receiptId: "rcpt-nextgoal",
  });
  receipts.unshift(callReceipt("nextgoal", "call-nextgoal", "incorrect", "anchored", 67, CALL_NEXTGOAL.prompt, "Called France — Morocco struck. Verified.", true));
  marketSays.push(marketSays_("m3", "draw-compressing", 67, "Morocco level and the draw price is compressing fast. The market thinks time is becoming the story."));
  scoreFan(0, false);
  snapshot("goal-mar", 67, "second-half", { home: 1, away: 1 }, "live", 2320, 0.82, "ev-goal-67");

  // 7 — feed gap swallows the corners call window → VOID
  const gap = { fromFeedTs: asFeedTimestamp(at(72)), toFeedTs: asFeedTimestamp(at(78)), detectedAt: at(78) };
  timeline.unshift({
    id: "tl-gap-72",
    feedTs: asFeedTimestamp(at(78)),
    kind: "phase",
    label: "Feed reconnecting — open calls paused",
    detail: "A gap in the feed crossed the corners call, so it can't be settled honestly.",
  });
  setCall({ ...CALL_CORNERS, status: "void" }, { yes: 410, no: 520 }, {
    myAnswer: "no",
    settlement: settlement("call-corners", "void", "", 78),
    outcome: "void",
  });
  snapshot("void", 78, "second-half", { home: 1, away: 1 }, "live", 2300, 0.6, "ev-goal-67", [gap]);

  // 8 — penalty France retakes the lead
  pushEvent(ev("penalty-scored", 82, "home", { home: 2, away: 1 }, "Mbappé (pen)"), "82' PENALTY — France! 2–1", REACTS(1120, 1600, 300));
  receipts.unshift(momentReceipt("pen", "penalty", "ev-penalty-scored-82", "proof-pending", 82, "France's penalty — logged from the feed", false));
  marketSays.push(marketSays_("m4", "not-buying-panic", 82, "France retake the lead from the spot and the market barely flinched — it saw this coming."));
  snapshot("penalty", 82, "second-half", { home: 2, away: 1 }, "live", 2380, 0.78, "ev-penalty-scored-82");

  // 9 — full time; pre-match pick settles correct, receipts anchored, report unlocks
  pushEvent(ev("full-time", 90, null, { home: 2, away: 1 }), "Full-time — France 2–1 Morocco");
  receipts[0] = momentReceipt("pen", "penalty", "ev-penalty-scored-82", "anchored", 84, "France's penalty — verified against the on-chain root", true);
  setCall({ ...CALL_PICK, status: "settled" }, { fra: 1180, draw: 410, mar: 550 }, {
    myAnswer: "fra",
    settlement: settlement("call-pick", "correct", "fra", 90),
    outcome: "correct",
    points: 118,
    receiptId: "rcpt-pick",
  });
  receipts.unshift(callReceipt("pick", "call-pick", "correct", "anchored", 90, CALL_PICK.prompt, "Called France from kick-off. Verified.", true));
  scoreFan(118, true);
  fanIq.roomRank = 46;
  snapshot("fulltime", 90, "full-time", { home: 2, away: 1 }, "finished", 2410, 0.3, "ev-full-time-90");

  return beats;
}

// Local helper kept after use above to avoid hoist confusion in the narrative order.
function marketSays_(id: string, kind: MarketSaysCard["kind"], minute: number, text: string): MarketSaysCard {
  return makeMarketSays(id, kind, minute, text);
}

export const SCENARIO_LABELS = [
  "prematch",
  "kickoff",
  "call-open",
  "goal",
  "receipt-anchored",
  "second-half",
  "goal-mar",
  "void",
  "penalty",
  "fulltime",
] as const;

export type ScenarioLabel = (typeof SCENARIO_LABELS)[number];
