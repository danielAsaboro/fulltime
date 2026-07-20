/**
 * Room radio — social second-screen voice for FullTime peer rooms.
 *
 * Not stadium PA / play-by-play. This room has a booth:
 *   - booth: ambient room medium (markets, stands, released events + odds)
 *   - book: personal lines for YOUR open stands / streak / markets
 *
 * Spoiler rule (implementation, not the product pitch): only feed signals that
 * already sit on the visible room timeline / market-says stream. Never invent
 * unreleased facts.
 */

import type { MatchEvent, MatchEventKind } from "./events";
import type { MarketSaysCard } from "./market-says";

/** Booth = house desk. Book = personal "your book" whisper. */
export type VoiceRole = "booth" | "book";

/** calm desk vs hype bench house style. */
export type HouseStyle = "desk" | "bench";

export interface VoiceClip {
  role: VoiceRole;
  text: string;
  gapAfterMs: number;
}

export interface RoomVoiceTeams {
  home: string;
  away: string;
}

export interface CatchMeUpInput {
  teams: RoomVoiceTeams;
  phase: string;
  statusLabel: string;
  score: { home: number; away: number } | null;
  minute: number | null;
  /** e.g. "the draw" / "home" from poll or call tallies */
  majoritySide: string | null;
  majorityShare: number | null;
  /** hottest market / last Market Says line */
  hottestMarketLine: string | null;
  lastBigCall: string | null;
  houseStyle?: HouseStyle;
}

export interface ReleasedEventVoiceInput {
  event: MatchEvent;
  teams: RoomVoiceTeams;
  /** Latest Market Says card tied to this moment, if any */
  market: MarketSaysCard | null;
  /** How many room members have open money/stands that feel this (optional) */
  openStandsTouching: number;
  /** Personal book hit */
  personal: {
    hasOpenStand: boolean;
    standLabel: string | null;
    underPressure: boolean;
    youreUpIfHolds: boolean;
    streakLength: number;
    streakAtRisk: boolean;
  };
  houseStyle?: HouseStyle;
}

export interface RoomMomentInput {
  kind: "stand-locked" | "poll-closed" | "market-says" | "streak-broken" | "streak-extended";
  teams: RoomVoiceTeams;
  label: string;
  detail?: string | null;
  personal?: boolean;
  houseStyle?: HouseStyle;
}

function styleOf(style: HouseStyle | undefined): HouseStyle {
  return style === "bench" ? "bench" : "desk";
}

function sideName(event: MatchEvent, teams: RoomVoiceTeams): string {
  if (event.side === "home") return teams.home;
  if (event.side === "away") return teams.away;
  return "";
}

function eventNoun(kind: MatchEventKind): string | null {
  switch (kind) {
    case "goal":
    case "penalty-scored":
      return "goal";
    case "own-goal":
      return "own goal";
    case "red-card":
    case "second-yellow":
      return "red card";
    case "half-time":
      return "half-time";
    case "end-of-regulation":
      return "end of regulation";
    case "full-time":
      return "full-time";
    case "kickoff":
      return "kickoff";
    case "second-half-start":
      return "second half";
    default:
      return null;
  }
}

function scoreBit(event: MatchEvent): string {
  if (!event.score) return "";
  return ` Score ${event.score.home}–${event.score.away}.`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return `${Math.round(n * 100)}%`;
}

/**
 * 30–45s catch-me-up when you join late or switch rooms.
 * Story of the game as this room lived it — not generic Pulse narrative.
 */
export function catchMeUpClips(input: CatchMeUpInput): VoiceClip[] {
  const style = styleOf(input.houseStyle);
  const { teams, score, minute, phase } = input;
  const scoreLine = score ? `${score.home}–${score.away}` : "still scoreless";
  const clock = minute != null ? ` minute ${minute}` : "";

  const open: string[] = [];
  if (style === "bench") {
    open.push(`You're in. ${teams.home} against ${teams.away}, ${scoreLine}${clock}.`);
  } else {
    open.push(
      `Quick catch-up. ${teams.home} versus ${teams.away}. Match state: ${scoreLine}${clock || `, ${input.statusLabel || phase}`}.`,
    );
  }

  if (input.majoritySide && input.majorityShare != null) {
    open.push(
      `Room temperature: majority still on ${input.majoritySide} at ${pct(input.majorityShare)}.`,
    );
  } else if (input.majoritySide) {
    open.push(`Room temperature: the booth is leaning ${input.majoritySide}.`);
  }

  if (input.hottestMarketLine) {
    open.push(`Hottest read: ${trimSentence(input.hottestMarketLine)}`);
  }

  if (input.lastBigCall) {
    open.push(`Last big call in here: ${trimSentence(input.lastBigCall)}`);
  }

  if (score && input.majoritySide?.toLowerCase().includes("draw") && score.home !== score.away) {
    open.push(
      `Score is ${scoreLine}, but the room is still on the draw — that's the social second screen.`,
    );
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

/**
 * Odds-as-drama: released pitch event + market/room money, not "Red card, France." alone.
 */
export function boothClipsForReleasedEvent(input: ReleasedEventVoiceInput): VoiceClip[] {
  const noun = eventNoun(input.event.kind);
  if (!noun) return [];

  const style = styleOf(input.houseStyle);
  const side = sideName(input.event, input.teams);
  const clips: VoiceClip[] = [];

  // Booth line: event + market, never pure PA
  let booth = "";
  if (input.market?.text) {
    booth =
      style === "bench"
        ? `${cap(noun)}${side ? ` ${side}` : ""}.${scoreBit(input.event)} And the market: ${trimSentence(input.market.text)}`
        : `${cap(noun)}${side ? `, ${side}` : ""}.${scoreBit(input.event)} ${trimSentence(input.market.text)}`;
  } else if (input.event.kind === "goal" || input.event.kind === "penalty-scored" || input.event.kind === "own-goal") {
    booth =
      style === "bench"
        ? `${cap(noun)}${side ? ` ${side}` : ""}.${scoreBit(input.event)} Watch the room's open stands — that changes money.`
        : `${cap(noun)}${side ? ` for ${side}` : ""}.${scoreBit(input.event)} Open stands in this room will feel that.`;
  } else if (input.event.kind === "red-card" || input.event.kind === "second-yellow") {
    booth =
      style === "bench"
        ? `Red card${side ? ` ${side}` : ""}. Big swing risk for anyone on the under or the short side.`
        : `Red card${side ? ` ${side}` : ""}. Away and home prices usually reprice hard — check your book.`;
  } else if (input.event.kind === "half-time" || input.event.kind === "full-time") {
    booth = `${cap(noun)}.${scoreBit(input.event)} Room board stays live for stands that haven't settled.`;
  } else if (input.event.kind === "kickoff" || input.event.kind === "second-half-start") {
    booth =
      style === "bench"
        ? `${cap(noun)}. Booth's open — stands, polls, and market reads only.`
        : `${cap(noun)}. This room's booth is ambient; peers still write the chat.`;
  } else {
    booth = `${cap(noun)}${side ? `, ${side}` : ""}.${scoreBit(input.event)}`;
  }

  if (input.openStandsTouching > 0 && !input.market) {
    booth += ` ${input.openStandsTouching} open stand${input.openStandsTouching === 1 ? "" : "s"} in this room sit near that line.`;
  }

  clips.push({ role: "booth", text: booth.trim(), gapAfterMs: 380 });

  // Your book — only if it touches this fan
  const p = input.personal;
  if (p.hasOpenStand && p.standLabel) {
    if (p.underPressure) {
      clips.push({
        role: "book",
        text:
          style === "bench"
            ? `Your book: ${p.standLabel} is under pressure after that.`
            : `Your book. You're on ${p.standLabel} — that line is under pressure.`,
        gapAfterMs: 280,
      });
    } else if (p.youreUpIfHolds) {
      clips.push({
        role: "book",
        text: `Your book. You're up on ${p.standLabel} if this holds.`,
        gapAfterMs: 280,
      });
    } else {
      clips.push({
        role: "book",
        text: `Your book still has ${p.standLabel} open.`,
        gapAfterMs: 280,
      });
    }
  }

  if (p.streakAtRisk && p.streakLength >= 2) {
    clips.push({
      role: "book",
      text: `Fan IQ streak at ${p.streakLength} — this next settle can break it.`,
      gapAfterMs: 0,
    });
  } else if (p.streakLength >= 3 && (input.event.kind === "goal" || input.event.kind === "red-card")) {
    clips.push({
      role: "book",
      text: `You're on a ${p.streakLength} call streak. Protect it.`,
      gapAfterMs: 0,
    });
  }

  if (clips.length === 1) clips[0]!.gapAfterMs = 0;
  return clips;
}

/** Room-only moments: new stand, poll closed, market card, streak — no pitch required. */
export function boothClipsForRoomMoment(input: RoomMomentInput): VoiceClip[] {
  const style = styleOf(input.houseStyle);
  const personal = Boolean(input.personal);

  switch (input.kind) {
    case "stand-locked":
      return [
        {
          role: personal ? "book" : "booth",
          text: personal
            ? `Stand locked. You're on ${input.label}${input.detail ? ` — ${input.detail}` : ""}.`
            : style === "bench"
              ? `New stand in the room: ${input.label}.`
              : `A stand just locked: ${input.label}.`,
          gapAfterMs: 0,
        },
      ];
    case "poll-closed":
      return [
        {
          role: "booth",
          text: input.detail
            ? `Poll closed. ${input.label}. Room landed on ${input.detail}.`
            : `Poll closed. ${input.label}.`,
          gapAfterMs: 0,
        },
      ];
    case "market-says":
      return [
        {
          role: "booth",
          text:
            style === "bench"
              ? `Market move. ${trimSentence(input.label)}`
              : `Market read for this room: ${trimSentence(input.label)}`,
          gapAfterMs: 0,
        },
      ];
    case "streak-broken":
      return [
        {
          role: "book",
          text: `Streak broken${input.detail ? ` — ${input.detail}` : ""}. Board resets; next call is clean.`,
          gapAfterMs: 0,
        },
      ];
    case "streak-extended":
      return [
        {
          role: "book",
          text: `Streak extended to ${input.label}. You're cooking.`,
          gapAfterMs: 0,
        },
      ];
    default:
      return [];
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function trimSentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** @deprecated Use boothClipsForReleasedEvent — kept for test migration helpers */
export function voiceClipsForEvent(
  event: MatchEvent,
  ctx: { home: string; away: string },
): VoiceClip[] {
  return boothClipsForReleasedEvent({
    event,
    teams: ctx,
    market: null,
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

/** Pre-warm pack: room radio lines, not play-by-play. */
export function voicePackTemplates(ctx: { home: string; away: string }): Array<{ id: string; role: VoiceRole; text: string }> {
  const teams = { home: ctx.home, away: ctx.away };
  const clips = [
    ...catchMeUpClips({
      teams,
      phase: "live",
      statusLabel: "live",
      score: { home: 1, away: 0 },
      minute: 62,
      majoritySide: "the draw",
      majorityShare: 0.38,
      hottestMarketLine: "Away win jumped after the card",
      lastBigCall: "next goal — home",
    }),
    ...boothClipsForRoomMoment({
      kind: "stand-locked",
      teams,
      label: "under 2.5",
      personal: true,
    }),
    ...boothClipsForRoomMoment({
      kind: "market-says",
      teams,
      label: "Away win just moved from 41 to 58",
    }),
  ];
  return clips.map((c, i) => ({ id: `pack-${i}`, role: c.role, text: c.text }));
}
