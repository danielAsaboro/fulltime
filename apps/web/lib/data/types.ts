/**
 * Renderer-facing data contract. Native Pear modules stay in the desktop worker;
 * the web app receives bounded, serializable room projections through preload.
 */

import type {
  AcceptedReceiptState,
  Call,
  CallStatus,
  Fixture,
  FixtureStatus,
  InviteId,
  MarketSaysCard,
  MessageId,
  MatchEvent,
  OddsSnapshot,
  Poll,
  PressureProjection,
  Room,
  RoomId,
  RoomItemId,
  RoomMemberRole,
  Settlement,
  UserId,
  WallClock,
} from "@fulltime/shared";

export type RoomPhase = "upcoming" | "live" | "finished";
export type AsyncStatus = "loading" | "ready" | "empty" | "error";

export interface Async<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  reload: () => void;
}

/** A signed fixture-feed projection. It never implies that a room exists. */
export interface FixtureCard {
  fixture: Fixture;
  phase: RoomPhase;
  status: FixtureStatus;
  score: { home: number; away: number } | null;
  minute: number | null;
}

export interface RoomView {
  room: Room;
  fixture: Fixture;
  phase: RoomPhase;
  members: number;
  inviteCode?: string;
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
  createdAt: WallClock;
  author?: RoomItemAuthor;
  reactions: ReactionSummary[];
  replies: ThreadReply[];
  replyCount: number;
  permalink: string;
  editedAt?: WallClock;
}

export interface TextMessage extends RoomFeedItemBase {
  kind: "text";
  messageId: MessageId;
  text: string;
  attachment?: RoomAttachment;
}

export type ChatMessage = TextMessage;

/** Authenticated descriptor for bytes stored in a room member's encrypted Hypercore. */
export interface RoomAttachment {
  version: 1;
  epoch: number;
  mediaId: string;
  authorId: UserId;
  coreKey: string;
  blob: {
    blockOffset: number;
    blockLength: number;
    byteOffset: number;
    byteLength: number;
  };
  encryption: {
    algorithm: "xsalsa20-poly1305-chunked-v1";
    noncePrefix: string;
    plaintextChunkBytes: number;
  };
  plaintextHash: string;
  hashAlgorithm: "blake2b-256";
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf" | "text/plain";
  name: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

/** Bytes returned only after the worker pins, decrypts, and verifies an attachment. */
export interface RoomMediaDownload {
  name: string;
  mimeType: RoomAttachment["mimeType"];
  bytes: Uint8Array;
}

export interface PollFeedItem extends RoomFeedItemBase {
  kind: "poll";
  poll: Poll;
  myVote?: string;
}

export interface SystemFeedItem extends RoomFeedItemBase {
  kind: "system";
  text: string;
  tone: "info" | "warning" | "success";
  noticeType?: "member-joined";
}

export type RoomFeedItem = TextMessage | PollFeedItem | SystemFeedItem;

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
  progress: number;
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
  slowModeSeconds: number;
  isClosed: boolean;
  permissions: RoomPermissions;
}

export interface RoomNotificationSettings {
  calls: boolean;
  messages: boolean;
  moderation: boolean;
}

export type ModerationReportReason =
  | "harassment"
  | "hate"
  | "misinformation"
  | "sexual-content"
  | "spam"
  | "threats"
  | "other";

export interface RoomModerationTarget {
  kind: "item" | "member";
  id: string;
}

export interface ModerationReportView {
  version: 1;
  roomId: RoomId;
  reportId: string;
  reporterId: UserId;
  target: RoomModerationTarget;
  reason: ModerationReportReason;
  note: string;
  createdAt: WallClock;
}

export interface RoomUnreadState {
  count: number;
  firstUnreadItemId: RoomItemId | null;
  lastReadItemId: RoomItemId | null;
  isAtLiveEdge: boolean;
}

export interface RoomAnswerView {
  receiptId: string;
  tokenId: string;
  receiptFeedKey: string;
  receiptIndex: number;
  servicePublicKey: string;
  userId: UserId;
  answerId: string;
  callId: string;
  optionId: string;
  submittedAt: WallClock;
  acceptedAt: WallClock;
  locksAt: number;
  fixtureFeedKey: string;
  fixtureFeedFork: number;
  fixtureFeedLength: number;
  fixtureFeedTreeHash: string;
  callFeedIndex: number;
  outcome: "accepted" | "correct" | "incorrect" | "void";
  points: number;
  receiptState: AcceptedReceiptState;
  scored: boolean;
}

export interface RoomCallView {
  call: Call;
  callFeedIndex: number | null;
  settlement: Settlement | null;
  settlementFeedIndex: number | null;
  status: CallStatus;
  tally: Record<string, number>;
  total: number;
  answers: RoomAnswerView[];
  myAnswer: RoomAnswerView | null;
  outcome: RoomAnswerView["outcome"] | null;
  points: number;
  receiptId: string | null;
}

export interface FanIqView {
  fanIq: number;
  accuracy: number;
  correctCalls: number;
  scoredCalls: number;
  roomRank: number;
  roomSize: number;
  leaderboard: Array<{
    userId: UserId;
    displayName: string;
    fanIq: number;
    accuracy: number;
    correctCalls: number;
    scoredCalls: number;
  }>;
}

export interface RoomReceiptView {
  id: string;
  roomId: RoomId;
  fixtureId: string;
  userId: UserId;
  answerId: string;
  callId: string;
  optionId: string;
  optionLabel: string;
  callPrompt: string;
  state: AcceptedReceiptState;
  outcome: RoomAnswerView["outcome"];
  points: number;
  scored: boolean;
  acceptedAt: WallClock;
  submittedAt: WallClock;
  locksAt: number;
  settlement: Settlement | null;
  technical: {
    tokenId: string;
    servicePublicKey: string;
    receiptFeedKey: string;
    receiptIndex: number;
    fixtureFeedKey: string;
    fixtureFeedFork: number;
    fixtureFeedLength: number;
    fixtureFeedTreeHash: string;
    callFeedIndex: number;
    anchor: null;
  };
}

export interface FixtureIntelligence {
  card: FixtureCard;
  timeline: MatchEvent[];
  oddsHistory: OddsSnapshot[];
  marketSays: MarketSaysCard[];
  pressure: PressureProjection;
  calls: Array<{
    call: Call;
    callFeedIndex: number | null;
    settlement: Settlement | null;
    settlementFeedIndex: number | null;
  }>;
  frontierFeedTs: number | null;
}

export interface RoomReplay {
  room: Room;
  fixture: Fixture;
  fixtureCard: FixtureCard;
  timeline: MatchEvent[];
  oddsHistory: OddsSnapshot[];
  marketSays: MarketSaysCard[];
  pressure: PressureProjection;
  calls: RoomCallView[];
  receipts: RoomReceiptView[];
  frontierFeedTs: number | null;
}

export interface RecordEntry {
  receiptId: string;
  roomId: RoomId;
  fixtureId: string;
  fixtureLabel: string;
  homeCode: string | null;
  awayCode: string | null;
  prompt: string;
  chosenOption: string;
  chosenLabel: string;
  acceptedAt: WallClock;
  outcome: RoomAnswerView["outcome"];
  points: number;
  receiptState: AcceptedReceiptState;
  scored: boolean;
}

export interface LocalRecordView {
  userId: UserId;
  displayName: string;
  fanIq: number;
  accuracy: number;
  matchesPlayed: number;
  totalCalls: number;
  entries: RecordEntry[];
}

export interface RoomLiveState {
  fixture: FixtureCard;
  timeline: MatchEvent[];
  oddsHistory: OddsSnapshot[];
  marketSays: MarketSaysCard[];
  pressure: PressureProjection;
  frontierFeedTs: number | null;
  calls: RoomCallView[];
  fanIq: FanIqView;
  receipts: RoomReceiptView[];
  unverifiedAnswerReferences: number;
  receiptVerificationErrors: Array<{ receiptId: string | null; code: string }>;
  attestationAvailable: boolean;
  items: RoomFeedItem[];
  polls: Poll[];
  members: RoomMemberView[];
  typingUsers: RoomMemberView[];
  unreadState: RoomUnreadState;
}

export interface Session {
  userId: string;
  displayName: string;
  peerPublicKey?: string;
}

export interface FixturesFilter {
  phase?: RoomPhase | "all";
}

export interface CreateRoomInput {
  fixtureId: string;
  roomName: string;
  displayName: string;
}

export interface SendMessageInput {
  text: string;
}

export interface CreatePollInput {
  question: string;
  options: string[];
}

export interface SendReplyInput {
  text: string;
}

export interface RoomPageOptions {
  limit?: number;
  cursor?: string | null;
}

export interface RoomCursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  epoch: number;
  revision: number;
}

export interface FullTimeData {
  listFixtures(filter?: FixturesFilter): Promise<FixtureCard[]>;
  getFixtureCard(fixtureId: string): Promise<FixtureCard | null>;
  getFixtureIntelligence(fixtureId: string): Promise<FixtureIntelligence | null>;
  subscribeFixtures(onFixture: (card: FixtureCard) => void): () => void;

  listRooms(): Promise<RoomView[]>;
  getRoom(roomId: string): Promise<RoomView | null>;
  getRoomByInvite(code: string): Promise<RoomView | null>;
  createRoom(input: CreateRoomInput): Promise<RoomDetailsView>;
  joinRoom(code: string): Promise<RoomView>;
  getRoomDetails(roomId: string): Promise<RoomDetailsView | null>;
  getRoomState(roomId: string): Promise<RoomLiveState>;
  submitAnswer(roomId: string, callId: string, optionId: string): Promise<RoomReceiptView>;
  getRoomReceipt(roomId: string, receiptId: string): Promise<RoomReceiptView>;
  getRoomReplay(roomId: string): Promise<RoomReplay>;
  getRecord(): Promise<LocalRecordView>;
  subscribeRoomState(roomId: string, onState: (state: RoomLiveState) => void): () => void;
  getRoomHistoryPage(roomId: string, options?: RoomPageOptions): Promise<RoomCursorPage<RoomFeedItem>>;
  getRoomThreadPage(roomId: string, itemId: string, options?: RoomPageOptions): Promise<RoomCursorPage<ThreadReply>>;

  votePoll(roomId: string, pollId: string, option: string): Promise<void>;
  sendMessage(roomId: string, input: SendMessageInput): Promise<ChatMessage>;
  uploadAttachment(roomId: string, file: File, text: string): Promise<ChatMessage>;
  downloadAttachment(roomId: string, itemId: string): Promise<RoomMediaDownload>;
  getNotificationSettings(roomId: string): Promise<RoomNotificationSettings>;
  updateNotificationSettings(roomId: string, settings: Partial<RoomNotificationSettings>): Promise<RoomNotificationSettings>;
  reportRoomTarget(roomId: string, target: RoomModerationTarget, reason: ModerationReportReason, note: string): Promise<{ reportId: string }>;
  listModerationReports(roomId: string): Promise<ModerationReportView[]>;
  createPoll(roomId: string, input: CreatePollInput): Promise<PollFeedItem>;
  reactToItem(roomId: string, itemId: string, emoji: string): Promise<void>;
  sendReply(roomId: string, itemId: string, input: SendReplyInput): Promise<ThreadReply>;
  setTyping(roomId: string, typing: boolean): Promise<void>;
  markRoomRead(roomId: string, itemId: string): Promise<void>;

  createInvite(roomId: string): Promise<InviteView>;
  regenerateInvite(roomId: string): Promise<InviteView>;
  revokeInvite(roomId: string): Promise<void>;
  renameRoom(roomId: string, name: string): Promise<void>;
  removeMember(roomId: string, userId: string): Promise<void>;
  setMemberRole(roomId: string, userId: string, role: "member" | "moderator"): Promise<void>;
  setSlowMode(roomId: string, seconds: number): Promise<void>;
  closeRoom(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;

  getSession(): Promise<Session | null>;
  signIn(displayName: string): Promise<Session>;
  signOut(): Promise<void>;
}
