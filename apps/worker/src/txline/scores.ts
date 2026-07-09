/**
 * Scores normalization. Turns a raw `TxScores` record into feed facts (status,
 * score, minute) plus the self-contained incidents carried on that one message
 * (goal, card, corner, VAR, substitution). Phase-transition events
 * (kickoff/half-time/full-time) are emitted by the state machine on status change,
 * since they need the prior state — this keeps per-message normalization pure.
 */

import {
  asFeedMessageId,
  asFixtureId,
  asMatchEventId,
  type FeedMessageId,
  type FixtureId,
  type FixtureScore,
  type FixtureStatus,
  type MatchEvent,
  type MatchEventKind,
  type TeamSide,
} from "@fulltime/shared";
import { asFeedTimestamp, type FeedTimestamp } from "@fulltime/shared";

import { statusFromCode } from "./status.js";
import type { SoccerData, SoccerScore, TxScores } from "./types.js";

export interface NormalizedScore {
  fixtureId: FixtureId;
  feedTs: FeedTimestamp;
  messageId: FeedMessageId;
  seq: number;
  statusCode: number | null;
  status: FixtureStatus;
  minute: number | null;
  score: FixtureScore;
  /** Whether this message actually carried a scoreline (vs. a status-only update). */
  hasScore: boolean;
  incidents: MatchEvent[];
}

export function parseScoresData(raw: string): TxScores | null {
  try {
    return JSON.parse(raw) as TxScores;
  } catch {
    return null;
  }
}

/** Scores ordering key: per-fixture sequence, namespaced by fixture. */
export function scoreMessageId(tx: TxScores): FeedMessageId {
  return asFeedMessageId(`${tx.fixtureId}:${tx.seq}`);
}

function sideOf(participant: number | undefined, p1IsHome: boolean): TeamSide | null {
  if (participant === 1) return p1IsHome ? "home" : "away";
  if (participant === 2) return p1IsHome ? "away" : "home";
  return null;
}

function goalsFor(total: SoccerScore | undefined): number {
  return total?.Goals ?? 0;
}

function extractScore(tx: TxScores): FixtureScore {
  const p1 = goalsFor(tx.scoreSoccer?.Participant1?.Total);
  const p2 = goalsFor(tx.scoreSoccer?.Participant2?.Total);
  return tx.participant1IsHome ? { home: p1, away: p2 } : { home: p2, away: p1 };
}

function incidentKinds(data: SoccerData): MatchEventKind[] {
  const kinds: MatchEventKind[] = [];
  if (data.Goal) {
    if (data.Penalty) kinds.push("penalty-scored");
    else if (data.GoalType && /own/i.test(data.GoalType)) kinds.push("own-goal");
    else kinds.push("goal");
  }
  if (data.RedCard) kinds.push("red-card");
  if (data.YellowCard) kinds.push("yellow-card");
  if (data.Corner) kinds.push("corner");
  if (data.VAR) kinds.push("var");
  if (data.PlayerInId && data.PlayerOutId) kinds.push("substitution");
  return kinds;
}

export function normalizeScore(tx: TxScores): NormalizedScore {
  const fixtureId = asFixtureId(String(tx.fixtureId));
  const feedTs = asFeedTimestamp(tx.ts);
  const messageId = scoreMessageId(tx);
  const statusCode = tx.dataSoccer?.StatusId ?? null;
  const minute = tx.dataSoccer?.Minutes ?? null;
  const side = sideOf(tx.dataSoccer?.Participant, tx.participant1IsHome);
  const score = extractScore(tx);

  const incidents: MatchEvent[] = tx.dataSoccer
    ? incidentKinds(tx.dataSoccer).map((kind) => ({
        id: asMatchEventId(`${messageId}:${kind}`),
        fixtureId,
        kind,
        feedTs,
        messageId,
        minute,
        side,
        score,
      }))
    : [];

  return {
    fixtureId,
    feedTs,
    messageId,
    seq: tx.seq,
    statusCode,
    status: statusFromCode(statusCode),
    minute,
    score,
    hasScore: tx.scoreSoccer !== undefined,
    incidents,
  };
}
