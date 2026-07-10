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
  FeedTimestamp,
  InviteId,
  MarketSaysCard,
  MatchEvent,
  MessageId,
  Note,
  Poll,
  Receipt,
  ReceiptState,
  Room,
  RoomId,
  RoomItemId,
  RoomMemberRole,
  Settlement,
  StreamDelayProfile,
  UserId,
  WallClock,
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

export interface RoomItemAuthor {
  userId: UserId;
  displayName: string;
  role: RoomMemberRole;
  isCurrentUser: boolean;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface MessageAttachment {
  id: string;
  type: "image";
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Browser-local object/data URL in mock mode; a durable URL in live mode. */
  url: string;
  status: "uploading" | "ready" | "failed" | "cancelled";
  progress: number;
  error?: string;
}

export interface ThreadReply {
  id: MessageId;
  itemId: RoomItemId;
  roomId: RoomId;
  author: RoomItemAuthor;
  text: string;
  createdAt: WallClock;
  editedAt?: WallClock;
  reactions: ReactionSummary[];
}

interface RoomFeedItemBase {
  id: RoomItemId;
  roomId: RoomId;
  /** Viewer-safe presentation instant. This, then id, is the canonical feed order. */
  releaseAt: WallClock;
  createdAt: WallClock;
  /** Authoritative TxLINE time for match-anchored items. */
  feedTs?: FeedTimestamp;
  matchMinute?: number | null;
  author?: RoomItemAuthor;
  reactions: ReactionSummary[];
  /** Complete in mock mode; a backend adapter may hydrate this on thread open. */
  replies: ThreadReply[];
  replyCount: number;
  permalink: string;
  editedAt?: WallClock;
}

export interface TextMessage extends RoomFeedItemBase {
  kind: "text";
  messageId: MessageId;
  text: string;
}

export interface ImageMessage extends RoomFeedItemBase {
  kind: "image";
  messageId: MessageId;
  caption?: string;
  attachment: MessageAttachment;
}

export type ChatMessage = TextMessage | ImageMessage;

export interface MatchEventFeedItem extends RoomFeedItemBase {
  kind: "event";
  event: MatchEvent;
  label: string;
}

export interface PollFeedItem extends RoomFeedItemBase {
  kind: "poll";
  poll: Poll;
  myVote?: string;
}

export interface CallFeedItem extends RoomFeedItemBase {
  kind: "call";
  call: CallView;
}

export interface OddsFeedItem extends RoomFeedItemBase {
  kind: "odds";
  marketSays: MarketSaysCard;
}

export interface ReceiptFeedItem extends RoomFeedItemBase {
  kind: "receipt";
  receipt: ReceiptView;
}

export interface SystemFeedItem extends RoomFeedItemBase {
  kind: "system";
  text: string;
  tone: "info" | "warning" | "success";
  /** Identifies ambient presence notices for passive presentation. */
  noticeType?: "member-joined";
}

export type RoomFeedItem =
  | ChatMessage
  | MatchEventFeedItem
  | PollFeedItem
  | CallFeedItem
  | OddsFeedItem
  | ReceiptFeedItem
  | SystemFeedItem;

export interface RoomMemberView {
  userId: UserId;
  displayName: string;
  role: RoomMemberRole;
  joinedAt: WallClock;
  isOnline: boolean;
  isCurrentUser: boolean;
  successfulInvites: number;
}

export type InviteStatus = "active" | "revoked" | "expired";

export interface InviteView {
  id: InviteId;
  roomId: RoomId;
  code: string;
  /** Referral URL for the current viewer. Copying it does not itself add Influence. */
  url: string;
  createdBy: UserId;
  createdAt: WallClock;
  expiresAt: WallClock | null;
  revokedAt: WallClock | null;
  status: InviteStatus;
  successfulJoins: number;
  viewerSuccessfulJoins: number;
}

export interface InfluenceView {
  score: number;
  level: number;
  successfulJoins: number;
  nextLevelAt: number | null;
  /** 0..1 progress within the current Influence level. */
  progress: number;
}

export interface RoomNotificationSettings {
  messages: boolean;
  mentions: boolean;
  matchEvents: boolean;
  receipts: boolean;
}

export interface RoomPermissions {
  canInvite: boolean;
  canRename: boolean;
  canRegenerateInvite: boolean;
  canRevokeInvite: boolean;
  canModerateMembers: boolean;
  canSetSlowMode: boolean;
  canCloseRoom: boolean;
}

export interface RoomDetailsView {
  room: Room;
  fixture: Fixture;
  members: RoomMemberView[];
  invite: InviteView | null;
  influence: InfluenceView;
  fanIq: FanIqView;
  notificationSettings: RoomNotificationSettings;
  slowModeSeconds: number;
  isClosed: boolean;
  media: MessageAttachment[];
  permissions: RoomPermissions;
}

export interface RoomUnreadState {
  count: number;
  firstUnreadItemId: RoomItemId | null;
  lastReadItemId: RoomItemId | null;
  isAtLiveEdge: boolean;
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
  /** Chronological, spoiler-safe room feed across chat and match primitives. */
  items: RoomFeedItem[];
  members: RoomMemberView[];
  typingUsers: RoomMemberView[];
  unreadState: RoomUnreadState;
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

/** A ready-to-enter guided room, including the viewer session it prepared. */
export interface DemoRoomEntry {
  room: RoomView;
  session: Session;
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
  /** ISO-2 country codes for the two teams, for flag rendering. */
  homeCode?: string;
  awayCode?: string;
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

export interface CreateRoomInput {
  fixtureId: string;
  roomName: string;
  displayName: string;
}

export type SendMessageInput =
  | { text: string; attachment?: never }
  | { text?: string; attachment: MessageAttachment };

export interface CreatePollInput {
  question: string;
  options: string[];
}

export interface SendReplyInput {
  text: string;
}

export interface FullTimeData {
  listFixtures(filter?: FixturesFilter): Promise<FixtureCard[]>;
  getFixtureCard(fixtureId: string): Promise<FixtureCard | null>;

  /** Prepare the guided full-match room at pre-match and return its signed-in viewer. */
  enterDemoRoom(): Promise<DemoRoomEntry>;

  getRoom(roomId: string): Promise<RoomView | null>;
  getRoomByInvite(code: string): Promise<RoomView | null>;
  createRoom(input: CreateRoomInput): Promise<RoomDetailsView>;
  joinRoom(code: string, referrerUserId?: string): Promise<RoomView>;
  getRoomDetails(roomId: string): Promise<RoomDetailsView | null>;

  getRoomState(roomId: string): Promise<RoomLiveState>;
  /** Push updates as the match progresses. Returns an unsubscribe function. */
  subscribeRoomState(roomId: string, onState: (state: RoomLiveState) => void): () => void;

  submitAnswer(roomId: string, callId: string, option: string): Promise<void>;
  sendReaction(roomId: string, emoji: string, anchorId: string): Promise<void>;
  sendNote(roomId: string, text: string, anchorId: string): Promise<void>;
  votePoll(roomId: string, pollId: string, option: string): Promise<void>;
  sendMessage(roomId: string, input: SendMessageInput): Promise<ChatMessage>;
  createPoll(roomId: string, input: CreatePollInput): Promise<PollFeedItem>;
  reactToItem(roomId: string, itemId: string, emoji: string): Promise<void>;
  sendReply(roomId: string, itemId: string, input: SendReplyInput): Promise<ThreadReply>;
  markRoomRead(roomId: string, itemId: string): Promise<void>;

  createInvite(roomId: string): Promise<InviteView>;
  regenerateInvite(roomId: string): Promise<InviteView>;
  revokeInvite(roomId: string): Promise<void>;
  renameRoom(roomId: string, name: string): Promise<void>;
  removeMember(roomId: string, userId: string): Promise<void>;
  setMemberRole(roomId: string, userId: string, role: "member" | "moderator"): Promise<void>;
  setSlowMode(roomId: string, seconds: number): Promise<void>;
  closeRoom(roomId: string): Promise<void>;
  updateNotificationSettings(roomId: string, settings: Partial<RoomNotificationSettings>): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  reportRoom(roomId: string, reason: string): Promise<void>;

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
