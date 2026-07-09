/**
 * The data seam. Every read/write the UI needs is expressed here as typed view
 * models over `@fulltime/shared`. Components consume ONLY `FullTimeData` — there
 * are no Supabase (or any transport) imports anywhere in the web app. Two
 * implementations satisfy this contract: `mock/` (default) and `live/` (stubs the
 * backend engineer fills). Odds arrive already de-vigged upstream (TxLINE `Pct[]`);
 * nothing here does de-vig math.
 */

import type {
  Call,
  CallOptionId,
  CalibrationMethod,
  Fixture,
  FixtureState,
  FixtureStatus,
  MarketSaysCard,
  MatchEvent,
  Note,
  Poll,
  Receipt,
  ReceiptState,
  Room,
  Settlement,
  StreamDelayProfile,
} from "@fulltime/shared";

export type RoomPhase = "upcoming" | "live" | "finished";

export type AsyncStatus = "loading" | "ready" | "empty" | "error";

/** Uniform async envelope every UI hook returns, with explicit empty/error states. */
export interface Async<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  reload: () => void;
}

export interface FixtureCard {
  fixture: Fixture;
  roomId: string;
  phase: RoomPhase;
  status: FixtureStatus;
  score: { home: number; away: number } | null;
  minute: number | null;
  /** Ambient crowd size — global tally rendered even in small rooms. */
  crowd: number;
}

export interface RoomView {
  room: Room;
  fixture: Fixture;
  phase: RoomPhase;
  crowd: number;
  members: number;
  /** Present for private rooms accessed by invite. */
  inviteCode?: string;
}

export type CallOutcome = "correct" | "incorrect" | "void";

export interface CallView {
  call: Call;
  /** option id → crowd count. */
  tally: Record<CallOptionId, number>;
  total: number;
  myAnswer?: CallOptionId;
  settlement?: Settlement;
  outcome?: CallOutcome;
  points?: number;
  receiptId?: string;
}

export type TimelineKind = "phase" | "event" | "settlement" | "market-says" | "eruption";

export interface TimelineItem {
  id: string;
  /** Feed time — the client release queue holds items until `feedTs + delay`. */
  feedTs: number;
  kind: TimelineKind;
  label: string;
  detail?: string;
  event?: MatchEvent;
  marketSays?: MarketSaysCard;
  settlement?: { callId: string; prompt: string; outcome: CallOutcome; winningOptionLabel: string };
  /** For eruptions: aggregate reaction emojis + counts. */
  reactions?: ReactionBurst[];
}

export interface ReactionBurst {
  emoji: string;
  count: number;
}

export interface FanIqView {
  fanIq: number;
  accuracy: number;
  scoredCalls: number;
  correctCalls: number;
  roomRank: number;
  roomSize: number;
}

export interface ReceiptView {
  receipt: Receipt;
  /** Fan-readable first line, no crypto vocabulary. */
  headline: string;
  callPrompt?: string;
  minute: number | null;
  /** Expandable technical layer for the proof drawer. */
  technical: {
    seq?: number;
    statKey?: string;
    statValidationRef?: string;
    anchorRef?: string;
    anchorUrl?: string;
  };
}

/** The composite the room subscribes to. Everything anchored in feed time. */
export interface RoomLiveState {
  fixtureState: FixtureState;
  phase: RoomPhase;
  crowd: number;
  timeline: TimelineItem[];
  calls: CallView[];
  marketSays: MarketSaysCard[];
  polls: Poll[];
  notes: Note[];
  receipts: ReceiptView[];
  fanIq: FanIqView;
  /** 0..1 room pressure — drives the ambient pressure indicator. */
  pressure: number;
  /** Latest event id, so the UI can flash an eruption exactly once. */
  lastEventId: string | null;
}

export interface Session {
  userId: string;
  displayName: string;
  /** Wallet address is an identifier only; never surfaced in the main flow. */
  walletAddress: string;
}

export interface CalibrationView {
  delaySeconds: number;
  profile?: StreamDelayProfile;
  method: CalibrationMethod;
}

export interface ReplayViewerState {
  delaySeconds: number;
  label: string;
  live: RoomLiveState;
}

export interface ReplayView {
  fixture: Fixture;
  /** Total corpus duration in feed ms, for the scrubber. */
  durationMs: number;
  startFeedTs: number;
  /** Ordered beats; the replay clock advances through them. */
  beats: RoomLiveState[];
}

export interface FanReportView {
  displayName: string;
  fixture: Fixture;
  finalScore: { home: number; away: number };
  fanIq: number;
  accuracy: number;
  rank: number;
  roomSize: number;
  percentile: number;
  scoredCalls: number;
  bestRead?: ReportCall;
  highestDifficultyHit?: ReportCall;
  biggestMiss?: ReportCall;
  calls: ReportCall[];
}

export interface ReportCall {
  callId: string;
  prompt: string;
  chosenLabel: string;
  outcome: CallOutcome;
  points: number;
  receiptState: ReceiptState;
  receiptId?: string;
  difficultyPct?: number;
}

export interface RecordView {
  displayName: string;
  fanIq: number;
  accuracy: number;
  matchesPlayed: number;
  totalCalls: number;
  entries: RecordEntry[];
}

export interface RecordEntry {
  callId: string;
  fixtureLabel: string;
  prompt: string;
  chosenLabel: string;
  outcome: CallOutcome;
  points: number;
  receiptState: ReceiptState;
  receiptId?: string;
  minute: number | null;
}

export interface FixturesFilter {
  phase?: RoomPhase | "all";
}

export interface FullTimeData {
  listFixtures(filter?: FixturesFilter): Promise<FixtureCard[]>;
  getFixtureCard(fixtureId: string): Promise<FixtureCard | null>;

  getRoom(roomId: string): Promise<RoomView | null>;
  getRoomByInvite(code: string): Promise<RoomView | null>;

  getRoomState(roomId: string): Promise<RoomLiveState>;
  /** Push updates as the match progresses. Returns an unsubscribe function. */
  subscribeRoomState(roomId: string, onState: (state: RoomLiveState) => void): () => void;

  submitAnswer(roomId: string, callId: string, option: string): Promise<void>;
  sendReaction(roomId: string, emoji: string, anchorId: string): Promise<void>;
  sendNote(roomId: string, text: string, anchorId: string): Promise<void>;
  votePoll(roomId: string, pollId: string, option: string): Promise<void>;

  getReceipt(receiptId: string): Promise<ReceiptView | null>;
  getReport(roomId: string): Promise<FanReportView | null>;
  getRecord(): Promise<RecordView | null>;
  getReplay(fixtureId: string): Promise<ReplayView | null>;

  getSession(): Promise<Session | null>;
  signIn(displayName: string): Promise<Session>;
  signOut(): Promise<void>;

  getCalibration(roomId: string): Promise<CalibrationView | null>;
  setCalibration(roomId: string, delaySeconds: number, method: CalibrationMethod): Promise<void>;
}
