/**
 * Room radio scripts for mobile — mirrors packages/shared match-voice
 * (booth + your book). Not stadium PA.
 */

export type VoiceRole = "booth" | "book";
export type HouseStyle = "desk" | "bench";

export interface VoiceClip {
  role: VoiceRole;
  text: string;
  gapAfterMs: number;
}

export interface MatchVoiceContext {
  home: string;
  away: string;
}

type EventLike = {
  id?: string | number;
  kind?: string;
  type?: string;
  minute?: number | null;
  side?: string | null;
  score?: { home: number; away: number } | null;
};

function styleOf(style?: HouseStyle): HouseStyle {
  return style === "bench" ? "bench" : "desk";
}

function sideName(event: EventLike, ctx: MatchVoiceContext): string {
  if (event.side === "home") return ctx.home;
  if (event.side === "away") return ctx.away;
  return "";
}

function trimSentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function catchMeUpClips(input: {
  teams: MatchVoiceContext;
  phase: string;
  statusLabel: string;
  score: { home: number; away: number } | null;
  minute: number | null;
  majoritySide: string | null;
  majorityShare: number | null;
  hottestMarketLine: string | null;
  lastBigCall: string | null;
  houseStyle?: HouseStyle;
}): VoiceClip[] {
  const style = styleOf(input.houseStyle);
  const scoreLine = input.score ? `${input.score.home}–${input.score.away}` : "still scoreless";
  const clock = input.minute != null ? ` minute ${input.minute}` : "";
  const open: string[] = [];
  if (style === "bench") {
    open.push(`You're in. ${input.teams.home} against ${input.teams.away}, ${scoreLine}${clock}.`);
  } else {
    open.push(
      `Quick catch-up. ${input.teams.home} versus ${input.teams.away}. Match state: ${scoreLine}${clock || `, ${input.statusLabel || input.phase}`}.`,
    );
  }
  if (input.majoritySide && input.majorityShare != null) {
    open.push(`Room temperature: majority still on ${input.majoritySide} at ${Math.round(input.majorityShare * 100)}%.`);
  } else if (input.majoritySide) {
    open.push(`Room temperature: the booth is leaning ${input.majoritySide}.`);
  }
  if (input.hottestMarketLine) open.push(`Hottest read: ${trimSentence(input.hottestMarketLine)}`);
  if (input.lastBigCall) open.push(`Last big call in here: ${trimSentence(input.lastBigCall)}`);
  if (input.score && input.majoritySide?.toLowerCase().includes("draw") && input.score.home !== input.score.away) {
    open.push(`Score is ${scoreLine}, but the room is still on the draw — that's the social second screen.`);
  }
  if (open.length === 1) {
    open.push("Peers write the chat. This booth stays ambient so you can keep eyes on the TV.");
  }
  return open.map((text, i) => ({
    role: "booth" as const,
    text,
    gapAfterMs: i === open.length - 1 ? 0 : 420,
  }));
}

export function boothClipsForReleasedEvent(input: {
  event: EventLike;
  teams: MatchVoiceContext;
  marketText: string | null;
  openStandsTouching: number;
  personal: {
    hasOpenStand: boolean;
    standLabel: string | null;
    underPressure: boolean;
    youreUpIfHolds: boolean;
    streakLength: number;
    streakAtRisk: boolean;
  };
  houseStyle?: HouseStyle;
}): VoiceClip[] {
  const kind = String(input.event.kind ?? input.event.type ?? "");
  const nounMap: Record<string, string> = {
    goal: "goal",
    "penalty-scored": "goal",
    "own-goal": "own goal",
    "red-card": "red card",
    "second-yellow": "red card",
    "half-time": "half-time",
    "end-of-regulation": "end of regulation",
    "full-time": "full-time",
    kickoff: "kickoff",
    "second-half-start": "second half",
  };
  const noun = nounMap[kind];
  if (!noun) return [];

  const style = styleOf(input.houseStyle);
  const side = sideName(input.event, input.teams);
  const score = input.event.score ? ` Score ${input.event.score.home}–${input.event.score.away}.` : "";
  const clips: VoiceClip[] = [];
  let booth = "";

  if (input.marketText) {
    booth =
      style === "bench"
        ? `${cap(noun)}${side ? ` ${side}` : ""}.${score} And the market: ${trimSentence(input.marketText)}`
        : `${cap(noun)}${side ? `, ${side}` : ""}.${score} ${trimSentence(input.marketText)}`;
  } else if (kind === "goal" || kind === "penalty-scored" || kind === "own-goal") {
    booth = `${cap(noun)}${side ? ` for ${side}` : ""}.${score} Open stands in this room will feel that.`;
  } else if (kind === "red-card" || kind === "second-yellow") {
    booth = `Red card${side ? ` ${side}` : ""}. Check your book — unders and short sides reprice.`;
  } else if (kind === "half-time" || kind === "full-time") {
    booth = `${cap(noun)}.${score} Room board stays live for stands that haven't settled.`;
  } else if (kind === "kickoff" || kind === "second-half-start") {
    booth = `${cap(noun)}. This room's booth is ambient; peers still write the chat.`;
  } else {
    booth = `${cap(noun)}${side ? `, ${side}` : ""}.${score}`;
  }

  if (input.openStandsTouching > 0 && !input.marketText) {
    booth += ` ${input.openStandsTouching} open stand${input.openStandsTouching === 1 ? "" : "s"} sit near that line.`;
  }

  clips.push({ role: "booth", text: booth.trim(), gapAfterMs: 380 });

  const p = input.personal;
  if (p.hasOpenStand && p.standLabel) {
    if (p.underPressure) {
      clips.push({ role: "book", text: `Your book. You're on ${p.standLabel} — that line is under pressure.`, gapAfterMs: 280 });
    } else if (p.youreUpIfHolds) {
      clips.push({ role: "book", text: `Your book. You're up on ${p.standLabel} if this holds.`, gapAfterMs: 280 });
    } else {
      clips.push({ role: "book", text: `Your book still has ${p.standLabel} open.`, gapAfterMs: 280 });
    }
  }
  if (p.streakAtRisk && p.streakLength >= 2) {
    clips.push({ role: "book", text: `Fan IQ streak at ${p.streakLength} — this next settle can break it.`, gapAfterMs: 0 });
  }

  if (clips.length === 1) clips[0]!.gapAfterMs = 0;
  return clips;
}

export function boothClipsForRoomMoment(input: {
  kind: "stand-locked" | "poll-closed" | "market-says" | "streak-broken" | "streak-extended";
  label: string;
  detail?: string | null;
  personal?: boolean;
}): VoiceClip[] {
  switch (input.kind) {
    case "stand-locked":
      return [{
        role: input.personal ? "book" : "booth",
        text: input.personal
          ? `Stand locked. You're on ${input.label}${input.detail ? ` — ${input.detail}` : ""}.`
          : `A stand just locked: ${input.label}.`,
        gapAfterMs: 0,
      }];
    case "poll-closed":
      return [{
        role: "booth",
        text: input.detail
          ? `Poll closed. ${input.label}. Room landed on ${input.detail}.`
          : `Poll closed. ${input.label}.`,
        gapAfterMs: 0,
      }];
    case "market-says":
      return [{ role: "booth", text: `Market read for this room: ${trimSentence(input.label)}`, gapAfterMs: 0 }];
    case "streak-broken":
      return [{ role: "book", text: "Streak broken. Board resets; next call is clean.", gapAfterMs: 0 }];
    case "streak-extended":
      return [{ role: "book", text: `Streak extended to ${input.label}. You're cooking.`, gapAfterMs: 0 }];
    default:
      return [];
  }
}

/** Legacy helper used by older mobile paths */
export function voiceClipsForEvent(event: EventLike, ctx: MatchVoiceContext): VoiceClip[] {
  return boothClipsForReleasedEvent({
    event,
    teams: ctx,
    marketText: null,
    openStandsTouching: 0,
    personal: {
      hasOpenStand: false,
      standLabel: null,
      underPressure: false,
      youreUpIfHolds: false,
      streakLength: 0,
      streakAtRisk: false,
    },
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
