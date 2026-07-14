import type { SoccerData, SoccerFixtureScore, SoccerScore, TxScores } from "../txline/types.js";

interface ArchivedClock { Seconds?: number }

export interface ArchivedScoreRecord {
  FixtureId: number;
  GameState: string;
  StartTime: number;
  CompetitionId: number;
  CountryId: number;
  SportId: number;
  Participant1IsHome: boolean;
  Participant1Id: number;
  Participant2Id: number;
  Action: string;
  Id: number;
  Ts: number;
  ConnectionId: number;
  Seq: number;
  StatusId?: number;
  Confirmed?: boolean;
  Clock?: ArchivedClock;
  Data?: SoccerData;
  Stats?: Record<string, number>;
  Participant?: number;
}

const PERIODS = {
  H1: 1_000,
  HT: 2_000,
  H2: 3_000,
  ET1: 4_000,
  ET2: 5_000,
  PE: 6_000,
  ETTotal: 7_000,
  Total: 0,
} as const;

function stat(stats: Record<string, number>, key: number): number {
  const value = stats[String(key)];
  return Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
}

function tally(stats: Record<string, number>, prefix: number, sideOffset: 0 | 1): SoccerScore {
  return {
    Goals: stat(stats, prefix + 1 + sideOffset),
    YellowCards: stat(stats, prefix + 3 + sideOffset),
    RedCards: stat(stats, prefix + 5 + sideOffset),
    Corners: stat(stats, prefix + 7 + sideOffset),
  };
}

function score(stats: Record<string, number>): SoccerFixtureScore {
  const participant = (sideOffset: 0 | 1) => Object.fromEntries(
    Object.entries(PERIODS).map(([period, prefix]) => [period, tally(stats, prefix, sideOffset)]),
  );
  return { Participant1: participant(0), Participant2: participant(1) };
}

function archivedStatus(statusId: number | undefined, action: string): number | undefined {
  if (statusId === 100 || action === "game_finalised") return 5;
  return statusId;
}

function confirmedIncident(record: ArchivedScoreRecord, emitted: Set<number>): SoccerData {
  const data: SoccerData = { ...(record.Data ?? {}) };
  const firstConfirmation = record.Confirmed === true && !emitted.has(record.Id);
  if (firstConfirmation) {
    if (record.Action === "goal") data.Goal = true;
    if (record.Action === "corner") data.Corner = true;
    if (record.Action === "yellow_card") data.YellowCard = true;
    if (record.Action === "var") data.VAR = true;
    if (["goal", "corner", "yellow_card", "var", "substitution"].includes(record.Action)) emitted.add(record.Id);
  }
  if (!firstConfirmation) {
    delete data.Goal;
    delete data.Corner;
    delete data.YellowCard;
    delete data.RedCard;
    delete data.VAR;
    delete data.PlayerInId;
    delete data.PlayerOutId;
  }
  data.StatusId = archivedStatus(record.StatusId, record.Action);
  data.Minutes = Number.isFinite(record.Clock?.Seconds) ? Math.max(0, Math.floor(record.Clock!.Seconds! / 60)) : undefined;
  data.Participant = record.Participant ?? data.Participant;
  return data;
}

export class ArchivedScoresAdapter {
  private readonly emittedIncidents = new Set<number>();

  adapt(record: ArchivedScoreRecord): TxScores {
    const stats = record.Stats ?? {};
    return {
      fixtureId: record.FixtureId,
      gameState: record.GameState,
      startTime: record.StartTime,
      competitionId: record.CompetitionId,
      countryId: record.CountryId,
      sportId: record.SportId,
      participant1IsHome: record.Participant1IsHome,
      participant1Id: record.Participant1Id,
      participant2Id: record.Participant2Id,
      action: record.Action,
      id: record.Id,
      ts: record.Ts,
      connectionId: record.ConnectionId,
      seq: record.Seq,
      scoreSoccer: score(stats),
      dataSoccer: confirmedIncident(record, this.emittedIncidents),
      stats,
    };
  }
}

export function parseArchivedScoresSse(source: string): Array<ArchivedScoreRecord> {
  return source.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("data: ")) return [];
    const value: unknown = JSON.parse(line.slice(6));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Archived TxLINE scores SSE contains a non-object data record");
    const record = value as Partial<ArchivedScoreRecord>;
    if (!Number.isSafeInteger(record.FixtureId) || !Number.isSafeInteger(record.Seq) || !Number.isSafeInteger(record.Ts) ||
        typeof record.Action !== "string" || typeof record.Participant1IsHome !== "boolean") {
      throw new Error("Archived TxLINE scores SSE contains an invalid record");
    }
    return [record as ArchivedScoreRecord];
  }).sort((left, right) => left.Seq - right.Seq);
}
