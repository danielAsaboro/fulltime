/**
 * Raw TxLINE wire types — mirror the OpenAPI spec (docs.yaml v1.5.2) for the
 * surfaces the World Cup soccer spine consumes. These are the exact shapes off the
 * wire (TxLINE's own casing); normalization into `@fulltime/shared` types happens
 * in the consumers. Kept here as the single, documented boundary with the feed.
 *
 * Feed identifiers: scores order by `seq` (per-fixture int); odds order by
 * `MessageId` (string). Both carry `ts`/`Ts` (int64 ms) feed time.
 */

// --- Auth ---

/** POST /auth/guest/start → 200 */
export interface TokenResponse {
  token: string;
}

/** POST /api/token/activate body (Bearer JWT). Response is text/plain: the API token. */
export interface ActivationPayload {
  txSig: string;
  walletSignature: string;
  leagues?: number[];
}

// --- Fixtures (GET /api/fixtures/snapshot → Fixture[]) ---

export interface TxFixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

// --- Scores SSE (GET /api/scores/stream → ScoresStreamEvent) ---

/** Per-period soccer tally. */
export interface SoccerScore {
  Goals: number;
  YellowCards: number;
  RedCards: number;
  Corners: number;
}

export interface SoccerTotalScore {
  H1?: SoccerScore;
  HT?: SoccerScore;
  H2?: SoccerScore;
  ET1?: SoccerScore;
  ET2?: SoccerScore;
  PE?: SoccerScore;
  ETTotal?: SoccerScore;
  Total?: SoccerScore;
}

export interface SoccerFixtureScore {
  Participant1: SoccerTotalScore;
  Participant2: SoccerTotalScore;
}

/** The event/incident carried on a scores update. Booleans flag what happened. */
export interface SoccerData {
  Action?: string;
  Corner?: boolean;
  Goal?: boolean;
  Penalty?: boolean;
  RedCard?: boolean;
  YellowCard?: boolean;
  VAR?: boolean;
  Minutes?: number;
  /** 1 or 2 — which participant the event belongs to. */
  Participant?: number;
  PlayerId?: number;
  PlayerInId?: number;
  PlayerOutId?: number;
  /** Game-phase status code (see status.ts). */
  StatusId?: number;
  Type?: string;
  Outcome?: string;
  GoalType?: string;
}

export type SoccerPossession = "Safe" | "Attack" | "Danger" | "HighDanger";

/** GET /api/scores/* record. Soccer fields are the `*Soccer` variants. */
export interface TxScores {
  fixtureId: number;
  gameState: string;
  startTime: number;
  competitionId: number;
  countryId: number;
  sportId: number;
  participant1IsHome: boolean;
  participant1Id: number;
  participant2Id: number;
  action: string;
  /** Update id within the fixture (int). */
  id: number;
  /** Feed time (ms, int64). */
  ts: number;
  connectionId: number;
  /** Per-fixture sequence number — the scores ordering key. */
  seq: number;
  /** Soccer game-phase status; the wire encodes this as an object variant, but the
   *  numeric code also rides on `dataSoccer.StatusId`. */
  statusSoccerId?: unknown;
  scoreSoccer?: SoccerFixtureScore;
  dataSoccer?: SoccerData;
  possession?: number;
  possessionType?: unknown;
  stats?: Record<string, number>;
}

// --- Odds SSE (GET /api/odds/stream → OddsStreamEvent) ---

export interface OddsPayload {
  FixtureId: number;
  /** Odds ordering key. */
  MessageId: string;
  /** Feed time (ms, int64). */
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  GameState?: string;
  InRunning: boolean;
  MarketParameters?: string;
  MarketPeriod?: string;
  /** Outcome labels, index-aligned with Prices/Pct (e.g. ["1","X","2"]). */
  PriceNames?: string[];
  /** Raw prices (int32, scaling TBC against live wire). */
  Prices?: number[];
  /** De-vigged Stable Price percentages, 3 dp or "NA" (e.g. "52.632"). */
  Pct?: string[];
}

// --- SSE envelope ---

/** A parsed Server-Sent Event line group. */
export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export interface ScoresStreamEvent {
  id?: string;
  event?: string;
  data: TxScores;
}

export interface OddsStreamEvent {
  id?: string;
  event?: string;
  data: OddsPayload;
}
