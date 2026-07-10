/**
 * Mock adapter — the default. Serves the deterministic France–Morocco scenario and
 * a spread of other fixtures so every UI state is designable and demoable without a
 * backend. The France–Morocco room plays the scenario beats (autoplay, or jumped to
 * a labelled state); user answers are applied live so settlement feels real.
 */

import {
  asFeedTimestamp,
  asInviteId,
  asMessageId,
  asRoomItemId,
  asUserId,
  asWallClock,
  releaseAt,
  type CalibrationMethod,
  type InviteId,
  type Poll,
  type Room,
  type RoomId,
  type RoomMemberRole,
  type UserId,
  type WallClock,
} from "@fulltime/shared";

import type {
  CalibrationView,
  ChatMessage,
  CreatePollInput,
  CreateRoomInput,
  CallView,
  DemoRoomEntry,
  FanReportView,
  FixtureCard,
  FixturesFilter,
  FullTimeData,
  InfluenceView,
  InviteView,
  MessageAttachment,
  PollFeedItem,
  ReactionSummary,
  RecordView,
  ReplayView,
  ReceiptView,
  ReportCall,
  RoomDetailsView,
  RoomFeedItem,
  RoomItemAuthor,
  RoomLiveState,
  RoomMemberView,
  RoomNotificationSettings,
  RoomPhase,
  RoomView,
  SendMessageInput,
  SendReplyInput,
  Session,
  ThreadReply,
} from "../types";
import { orderRoomFeedItems, orderThreadReplies } from "../room-feed";
import {
  FIXTURE_SEEDS,
  FM_FIXTURE_ID,
  FM_INVITE_CODE,
  FM_KICKOFF_MS,
  FM_ROOM_ID,
  SEED_BY_FIXTURE,
  SEED_BY_ROOM,
} from "./corpus";
import { buildFraMarBeats, SCENARIO_LABELS, type ScenarioLabel } from "./scenario";

const AUTOPLAY_INTERVAL_MS = 8_000;
const MAX_MESSAGE_LENGTH = 1_000;
const MOCK_CLOCK_START = FM_KICKOFF_MS + 13 * 60_000;
const DEFAULT_NOTIFICATIONS: RoomNotificationSettings = {
  messages: true,
  mentions: true,
  matchEvents: true,
  receipts: true,
};

interface StoredMember {
  userId: UserId;
  displayName: string;
  role: RoomMemberRole;
  joinedAt: WallClock;
  isOnline: boolean;
}

interface StoredRoom {
  room: Room;
  members: Map<string, StoredMember>;
  /** Accounts that have ever converted into this room, even if they later leave. */
  joinedUsers: Set<string>;
  activeInviteId: InviteId | null;
  notificationSettings: Map<string, RoomNotificationSettings>;
  slowModeSeconds: number;
  isClosed: boolean;
}

interface StoredInvite {
  id: InviteId;
  roomId: RoomId;
  code: string;
  createdBy: UserId;
  createdAt: WallClock;
  expiresAt: WallClock | null;
  revokedAt: WallClock | null;
  /** Unique invitees attributed to this generation, irrespective of referrer. */
  joinedUsers: Set<string>;
  /** Per-member conversions for referral feedback. */
  referrals: Map<string, Set<string>>;
}

interface FeedBaseFields {
  id: RoomFeedItem["id"];
  roomId: RoomId;
  releaseAt: WallClock;
  createdAt: WallClock;
  feedTs?: RoomFeedItem["feedTs"];
  matchMinute?: number | null;
  author?: RoomItemAuthor;
  reactions: ReactionSummary[];
  replies: ThreadReply[];
  replyCount: number;
  permalink: string;
}

function phaseOf(status: string): RoomPhase {
  if (["scheduled", "delayed", "postponed"].includes(status)) return "upcoming";
  if (["full-time", "after-extra-time", "after-penalties", "abandoned", "cancelled"].includes(status))
    return "finished";
  return "live";
}

function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export class MockDataClient implements FullTimeData {
  private readonly beats = buildFraMarBeats();
  private beatIndex = SCENARIO_LABELS.indexOf("call-open");
  private autoplay = true;
  private session: Session | null = null;
  private readonly calibrations = new Map<string, CalibrationView>();
  private readonly answers = new Map<string, string>();
  private readonly subscribers = new Map<string, Set<(s: RoomLiveState) => void>>();
  private readonly rooms = new Map<string, StoredRoom>();
  private readonly invites = new Map<string, StoredInvite>();
  private readonly customItems = new Map<string, RoomFeedItem[]>();
  private readonly reactions = new Map<string, Set<string>>();
  private readonly replies = new Map<string, ThreadReply[]>();
  private readonly pollVotes = new Map<string, string>();
  private readonly influenceJoins = new Map<string, Set<string>>();
  private readonly lastPosts = new Map<string, number>();
  private readonly readCursors = new Map<string, string>();
  private readonly reports = new Set<string>();
  private roomCounter = 0;
  private inviteCounter = 0;
  private messageCounter = 0;
  private pollCounter = 0;
  private replyCounter = 0;
  private clockMs = MOCK_CLOCK_START;
  private presentationAnchorFeedMs = Number(
    this.beats[this.beatIndex]!.state.fixtureState.lastFeedTs ?? FM_KICKOFF_MS,
  );
  private presentationAnchorWallMs = Date.now();
  private presentationOffsetMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    const demo = this.ensureRoomRecord(FM_ROOM_ID);
    demo.room = {
      ...demo.room,
      type: "private",
      name: "The Away End",
      inviteCode: FM_INVITE_CODE,
      createdBy: asUserId("u-amina"),
    };
    demo.members.set("u-amina", {
      userId: asUserId("u-amina"),
      displayName: "Amina",
      role: "creator",
      joinedAt: asWallClock(FM_KICKOFF_MS - 40 * 60_000),
      isOnline: true,
    });
    demo.members.set("u-theo", {
      userId: asUserId("u-theo"),
      displayName: "Theo",
      role: "moderator",
      joinedAt: asWallClock(FM_KICKOFF_MS - 35 * 60_000),
      isOnline: true,
    });
    demo.members.set("u-jo", {
      userId: asUserId("u-jo"),
      displayName: "Jo",
      role: "member",
      joinedAt: asWallClock(FM_KICKOFF_MS - 30 * 60_000),
      isOnline: false,
    });
    demo.joinedUsers = new Set(demo.members.keys());

    const active = this.seedInvite(demo, FM_INVITE_CODE, "u-amina", null, null);
    demo.activeInviteId = active.id;
    this.seedInvite(demo, "REVOKED", "u-amina", null, asWallClock(FM_KICKOFF_MS - 1));
    this.seedInvite(demo, "EXPIRED", "u-amina", asWallClock(FM_KICKOFF_MS - 1), null);
    this.customItems.set(FM_ROOM_ID, seedRoomItems());
    for (const [itemId, replies] of seedRoomReplies()) {
      this.replies.set(`${FM_ROOM_ID}:${itemId}`, replies);
    }
  }

  configure(options: { scenario?: string | null; autoplay?: boolean }): void {
    const label = options.scenario as ScenarioLabel | null | undefined;
    if (label && SCENARIO_LABELS.includes(label)) {
      this.beatIndex = SCENARIO_LABELS.indexOf(label);
      this.autoplay = options.autoplay ?? false;
      this.resetPresentationClock();
    } else if (options.autoplay !== undefined) {
      this.autoplay = options.autoplay;
    }
    this.emit();
  }

  get scenarioLabel(): ScenarioLabel {
    return SCENARIO_LABELS[this.beatIndex] ?? "kickoff";
  }

  get autoplayEnabled(): boolean {
    return this.autoplay;
  }

  jumpTo(label: ScenarioLabel): void {
    const idx = SCENARIO_LABELS.indexOf(label);
    if (idx >= 0) {
      this.beatIndex = idx;
      this.resetPresentationClock();
      this.emit();
    }
  }

  /** Deterministic test/demo control for releasing MatchSync-delayed items. */
  advancePresentationBy(ms: number): void {
    this.presentationOffsetMs += Math.max(0, ms);
    this.emit();
  }

  private resetPresentationClock(): void {
    this.presentationAnchorFeedMs = Number(
      this.beats[this.beatIndex]!.state.fixtureState.lastFeedTs ?? FM_KICKOFF_MS,
    );
    this.presentationAnchorWallMs = Date.now();
    this.presentationOffsetMs = 0;
  }

  private presentationNow(): number {
    return this.presentationAnchorFeedMs + (Date.now() - this.presentationAnchorWallMs) + this.presentationOffsetMs;
  }

  private presentedBeat(roomId: string): RoomLiveState {
    const delayMs = (this.calibrations.get(this.calibrationKey(roomId))?.delaySeconds ?? 0) * 1_000;
    const now = this.presentationNow();
    for (let index = this.beatIndex; index >= 0; index -= 1) {
      const candidate = this.beats[index]!.state;
      const feedTs = candidate.fixtureState.lastFeedTs;
      if (feedTs === null || Number(feedTs) + delayMs <= now) return candidate;
    }
    return this.beats[0]!.state;
  }

  // --- Fixtures ---

  async listFixtures(filter: FixturesFilter = {}): Promise<FixtureCard[]> {
    const cards = FIXTURE_SEEDS.map((seed) => this.cardFor(String(seed.fixture.id)));
    const wanted = filter.phase && filter.phase !== "all" ? filter.phase : null;
    return delay(wanted ? cards.filter((c) => c.phase === wanted) : cards);
  }

  async getFixtureCard(fixtureId: string): Promise<FixtureCard | null> {
    return delay(SEED_BY_FIXTURE.has(fixtureId) ? this.cardFor(fixtureId) : null);
  }

  private cardFor(fixtureId: string): FixtureCard {
    const seed = SEED_BY_FIXTURE.get(fixtureId)!;
    const isFm = seed.roomId === FM_ROOM_ID;
    const beat = isFm ? this.currentBeat() : null;
    const score = beat ? beat.fixtureState.score : seed.score;
    const minute = beat ? beat.fixtureState.minute : seed.minute;
    const status = beat ? beat.fixtureState.status : seed.fixture.status;
    const crowd = beat ? beat.crowd : Math.round(300 + Number(fixtureId) * 7);
    return {
      fixture: seed.fixture,
      roomId: seed.roomId,
      phase: phaseOf(status),
      status,
      score,
      minute,
      crowd,
    };
  }

  // --- Rooms ---

  private nextClock(_roomId?: string): WallClock {
    const latestFeedTs = Number(this.currentBeat().fixtureState.lastFeedTs ?? 0);
    this.clockMs = Math.max(this.clockMs, latestFeedTs, this.presentationNow()) + 1_000;
    return asWallClock(this.clockMs);
  }

  private activateSession(displayName: string): Session {
    const next = makeSession(displayName);
    const previousUserId = this.session?.userId;
    if (previousUserId && previousUserId !== next.userId) {
      for (const room of this.rooms.values()) {
        const previousMember = room.members.get(previousUserId);
        if (previousMember) room.members.set(previousUserId, { ...previousMember, isOnline: false });
      }
    }
    this.session = next;
    for (const room of this.rooms.values()) {
      const member = room.members.get(next.userId);
      if (member) room.members.set(next.userId, { ...member, displayName: next.displayName, isOnline: true });
    }
    return next;
  }

  private ensureRoomRecord(roomId: string): StoredRoom {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const seed = SEED_BY_ROOM.get(roomId);
    if (!seed) throw new Error("Room not found");
    const record: StoredRoom = {
      room: {
        id: roomId as RoomId,
        fixtureId: seed.fixture.id,
        type: "global",
        name: `${seed.fixture.home.name} vs ${seed.fixture.away.name}`,
        createdAt: asWallClock(Number(seed.fixture.kickoff)),
      },
      members: new Map(),
      joinedUsers: new Set(),
      activeInviteId: null,
      notificationSettings: new Map(),
      slowModeSeconds: 0,
      isClosed: false,
    };
    this.rooms.set(roomId, record);
    return record;
  }

  private seedInvite(
    room: StoredRoom,
    code: string,
    createdBy: string,
    expiresAt: WallClock | null,
    revokedAt: WallClock | null,
  ): StoredInvite {
    const invite: StoredInvite = {
      id: asInviteId(`inv-seed-${code.toLowerCase()}`),
      roomId: room.room.id,
      code,
      createdBy: asUserId(createdBy),
      createdAt: asWallClock(FM_KICKOFF_MS - 45 * 60_000),
      expiresAt,
      revokedAt,
      joinedUsers: new Set(),
      referrals: new Map(),
    };
    this.invites.set(code.toUpperCase(), invite);
    return invite;
  }

  private inviteStatus(invite: StoredInvite): InviteView["status"] {
    if (invite.revokedAt) return "revoked";
    if (invite.expiresAt && invite.expiresAt <= this.clockMs) return "expired";
    return "active";
  }

  private findInvite(code: string): StoredInvite | null {
    return this.invites.get(code.trim().toUpperCase()) ?? null;
  }

  private activeInvite(room: StoredRoom): StoredInvite | null {
    if (!room.activeInviteId) return null;
    const invite = [...this.invites.values()].find((candidate) => candidate.id === room.activeInviteId);
    return invite && this.inviteStatus(invite) === "active" ? invite : null;
  }

  private inviteView(invite: StoredInvite): InviteView {
    const viewer = this.session?.userId ?? "guest";
    const viewerJoins = invite.referrals.get(viewer)?.size ?? 0;
    return {
      id: invite.id,
      roomId: invite.roomId,
      code: invite.code,
      url: `/join/${invite.code}?ref=${encodeURIComponent(viewer)}`,
      createdBy: invite.createdBy,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      revokedAt: invite.revokedAt,
      status: this.inviteStatus(invite),
      successfulJoins: invite.joinedUsers.size,
      viewerSuccessfulJoins: viewerJoins,
    };
  }

  private makeInvite(room: StoredRoom, creator: UserId): StoredInvite {
    this.inviteCounter += 1;
    const code = `FT${String(this.inviteCounter).padStart(4, "0")}`;
    const invite: StoredInvite = {
      id: asInviteId(`inv-local-${String(this.inviteCounter).padStart(3, "0")}`),
      roomId: room.room.id,
      code,
      createdBy: creator,
      createdAt: this.nextClock(String(room.room.id)),
      expiresAt: null,
      revokedAt: null,
      joinedUsers: new Set(),
      referrals: new Map(),
    };
    this.invites.set(code, invite);
    room.activeInviteId = invite.id;
    room.room = { ...room.room, inviteCode: code };
    return invite;
  }

  private roomView(room: StoredRoom): RoomView {
    const seed = SEED_BY_FIXTURE.get(String(room.room.fixtureId));
    if (!seed) throw new Error("Fixture not found");
    const card = this.cardFor(String(seed.fixture.id));
    return {
      room: { ...room.room },
      fixture: {
        ...seed.fixture,
        status: card.status,
        minute: card.minute,
        ...(card.score ? { score: card.score } : {}),
      },
      phase: card.phase,
      crowd: card.crowd,
      members: room.members.size,
      ...(room.room.inviteCode ? { inviteCode: room.room.inviteCode } : {}),
    };
  }

  async enterDemoRoom(): Promise<DemoRoomEntry> {
    const session = this.activateSession("Demo Fan");
    const demo = this.ensureRoomRecord(FM_ROOM_ID);
    const invite = this.findInvite(FM_INVITE_CODE);
    if (!invite) throw new Error("Demo invite is unavailable");

    // Restore the seed room even if it was renamed, closed, or had its invite
    // replaced during an earlier browser-local demo session.
    demo.isClosed = false;
    demo.slowModeSeconds = 0;
    demo.activeInviteId = invite.id;
    demo.room = {
      ...demo.room,
      name: "The Away End",
      inviteCode: FM_INVITE_CODE,
    };
    invite.revokedAt = null;
    invite.expiresAt = null;

    // The guided account carries a small deterministic referral history so the
    // Influence/share feedback is visible without conflating it with Fan IQ.
    const conversions = new Set([
      "u-demo-friend-1",
      "u-demo-friend-2",
      "u-demo-friend-3",
      "u-demo-friend-4",
    ]);
    invite.referrals.set(session.userId, new Set(conversions));
    for (const userId of conversions) invite.joinedUsers.add(userId);
    this.influenceJoins.set(session.userId, new Set(conversions));

    // Discard browser-local interaction residue so replaying /demo always opens
    // the same authored match story before new optimistic actions are added.
    this.customItems.set(FM_ROOM_ID, seedRoomItems());
    for (const key of this.reactions.keys()) {
      if (key.startsWith(`${FM_ROOM_ID}:`)) this.reactions.delete(key);
    }
    for (const key of this.replies.keys()) {
      if (key.startsWith(`${FM_ROOM_ID}:`)) this.replies.delete(key);
    }
    for (const [itemId, replies] of seedRoomReplies()) {
      this.replies.set(`${FM_ROOM_ID}:${itemId}`, replies);
    }
    for (const key of this.pollVotes.keys()) {
      if (key.startsWith(`${FM_ROOM_ID}:`)) this.pollVotes.delete(key);
    }
    for (const key of this.lastPosts.keys()) {
      if (key.startsWith(`${FM_ROOM_ID}:`)) this.lastPosts.delete(key);
    }
    demo.notificationSettings.delete(session.userId);

    // A demo visit is a fresh watch-along: no old delay or read cursor should
    // hide the pre-match room state when somebody replays it.
    this.calibrations.delete(this.calibrationKey(FM_ROOM_ID, session.userId));
    this.readCursors.delete(`${FM_ROOM_ID}:${session.userId}`);
    this.clockMs = FM_KICKOFF_MS - 60_000;
    this.answers.set(`match:${session.userId}:call-pick`, "fra");
    this.answers.set(`match:${session.userId}:call-score30`, "yes");
    this.answers.set(`match:${session.userId}:call-nextgoal`, "fra");
    this.answers.set(`match:${session.userId}:call-corners`, "no");
    this.configure({ scenario: "prematch", autoplay: true });

    const room = await this.joinRoom(FM_INVITE_CODE, "u-amina");
    const demoItems = this.customItems.get(FM_ROOM_ID) ?? [];
    const joinNoticeIndex = demoItems.findIndex(
      (item) => item.kind === "system" && item.text === `${session.displayName} joined the room`,
    );
    const joinedAt = asWallClock(FM_KICKOFF_MS - 30_000);
    const joinNotice = this.systemItem(
      FM_ROOM_ID,
      `${session.displayName} joined the room`,
      "info",
      joinedAt,
      "item-system-demo-fan-joined",
      "member-joined",
    );
    if (joinNoticeIndex >= 0) demoItems[joinNoticeIndex] = joinNotice;
    else demoItems.push(joinNotice);
    this.customItems.set(FM_ROOM_ID, demoItems);
    return { room, session };
  }

  async getRoom(roomId: string): Promise<RoomView | null> {
    if (!this.rooms.has(roomId) && !SEED_BY_ROOM.has(roomId)) return delay(null);
    const room = this.ensureRoomRecord(roomId);
    if (!this.hasReadAccess(room)) return delay(null);
    return delay(this.roomView(room));
  }

  async getRoomByInvite(code: string): Promise<RoomView | null> {
    const invite = this.findInvite(code);
    if (!invite || this.inviteStatus(invite) !== "active") return delay(null);
    const room = this.rooms.get(String(invite.roomId));
    return delay(room && !room.isClosed ? this.roomView(room) : null);
  }

  async createRoom(input: CreateRoomInput): Promise<RoomDetailsView> {
    const fixture = SEED_BY_FIXTURE.get(input.fixtureId);
    if (!fixture) throw new Error("Fixture not found");
    const name = input.roomName.trim();
    if (!name) throw new Error("Room name is required");
    if (name.length > 80) throw new Error("Room name must be 80 characters or fewer");
    const session = this.activateSession(input.displayName);
    this.roomCounter += 1;
    const roomId = `room-local-${String(this.roomCounter).padStart(3, "0")}` as RoomId;
    const createdAt = this.nextClock(roomId);
    const room: StoredRoom = {
      room: {
        id: roomId,
        fixtureId: fixture.fixture.id,
        type: "private",
        name,
        createdBy: asUserId(session.userId),
        createdAt,
      },
      members: new Map(),
      joinedUsers: new Set([session.userId]),
      activeInviteId: null,
      notificationSettings: new Map(),
      slowModeSeconds: 0,
      isClosed: false,
    };
    room.members.set(session.userId, {
      userId: asUserId(session.userId),
      displayName: session.displayName,
      role: "creator",
      joinedAt: createdAt,
      isOnline: true,
    });
    this.rooms.set(roomId, room);
    const invite = this.makeInvite(room, asUserId(session.userId));
    this.customItems.set(roomId, [
      this.systemItem(roomId, `Room created by ${session.displayName}`, "success", createdAt),
    ]);
    room.activeInviteId = invite.id;
    const details = await this.getRoomDetails(roomId);
    if (!details) throw new Error("Room creation failed");
    return details;
  }

  async joinRoom(code: string, referrerUserId?: string): Promise<RoomView> {
    const session = this.requireSession();
    const invite = this.findInvite(code);
    if (!invite) throw new Error("Invite not found");
    const status = this.inviteStatus(invite);
    if (status === "revoked") throw new Error("Invite has been revoked");
    if (status === "expired") throw new Error("Invite has expired");
    const room = this.rooms.get(String(invite.roomId));
    if (!room || room.isClosed) throw new Error("Room is closed");
    const isNewMember = !room.members.has(session.userId);
    if (isNewMember) {
      const firstRoomJoin = !room.joinedUsers.has(session.userId);
      room.members.set(session.userId, {
        userId: asUserId(session.userId),
        displayName: session.displayName,
        role: "member",
        joinedAt: this.nextClock(String(invite.roomId)),
        isOnline: true,
      });
      room.joinedUsers.add(session.userId);
      if (firstRoomJoin) invite.joinedUsers.add(session.userId);
      const referrer = referrerUserId && room.members.get(referrerUserId);
      if (firstRoomJoin && referrer && referrer.userId !== session.userId) {
        let inviteConversions = invite.referrals.get(referrerUserId!);
        if (!inviteConversions) {
          inviteConversions = new Set();
          invite.referrals.set(referrerUserId!, inviteConversions);
        }
        inviteConversions.add(session.userId);
        let uniqueJoins = this.influenceJoins.get(referrerUserId!);
        if (!uniqueJoins) {
          uniqueJoins = new Set();
          this.influenceJoins.set(referrerUserId!, uniqueJoins);
        }
        uniqueJoins.add(session.userId);
      }
      const items = this.customItems.get(String(invite.roomId)) ?? [];
      items.push(
        this.systemItem(
          invite.roomId,
          `${session.displayName} joined the room`,
          "info",
          this.nextClock(String(invite.roomId)),
          undefined,
          "member-joined",
        ),
      );
      this.customItems.set(String(invite.roomId), items);
      this.emitRoom(String(invite.roomId));
    }
    return delay(this.roomView(room), 80);
  }

  // --- Live room state ---

  private currentBeat(): RoomLiveState {
    return this.beats[this.beatIndex]!.state;
  }

  private answerKey(userId: string, view: CallView): string {
    return view.call.roomId
      ? `room:${view.call.roomId}:${userId}:${view.call.id}`
      : `match:${userId}:${view.call.id}`;
  }

  private applyAnswers(state: RoomLiveState, roomId: string): RoomLiveState {
    const userId = this.session?.userId;
    const calls = state.calls.map((view): CallView => {
      const {
        myAnswer: _scriptedAnswer,
        outcome: _scriptedOutcome,
        points: _scriptedPoints,
        receiptId: scriptedReceiptId,
        ...publicView
      } = view;
      const answered = userId ? this.answers.get(this.answerKey(userId, view)) : undefined;
      if (!answered) return publicView;
      const tally = { ...publicView.tally, [answered]: (publicView.tally[answered] ?? 0) + 1 };
      let outcome: CallView["outcome"];
      let points: number | undefined;
      if (view.settlement && view.settlement.outcome.status === "settled") {
        outcome = view.settlement.outcome.winningOption === answered ? "correct" : "incorrect";
        points = outcome === "correct" ? Math.round(100 / (view.call.difficulty ?? 0.5)) : 0;
      } else if (view.settlement?.outcome.status === "void") {
        outcome = "void";
        points = 0;
      }
      return {
        ...publicView,
        myAnswer: answered,
        tally,
        total: publicView.total + 1,
        ...(outcome ? { outcome } : {}),
        ...(points !== undefined ? { points } : {}),
        ...(scriptedReceiptId ? { receiptId: scriptedReceiptId } : {}),
      };
    });
    const scored = calls.filter((view) => view.myAnswer && view.settlement?.outcome.status === "settled");
    const correct = scored.filter((view) => view.outcome === "correct");
    const fanIq = correct.reduce((total, view) => total + (view.points ?? 0), 0);
    const accuracy = scored.length ? correct.length / scored.length : 0;
    const storedRoom = this.rooms.get(roomId);
    const roomSize = storedRoom?.room.type === "private"
      ? storedRoom.members.size
      : Math.max(state.fanIq.roomSize, storedRoom?.members.size ?? 0);
    return {
      ...state,
      calls,
      fanIq: {
        fanIq,
        accuracy,
        scoredCalls: scored.length,
        correctCalls: correct.length,
        roomRank: scored.length ? Math.max(1, Math.round(roomSize * (1 - accuracy * 0.8))) : 0,
        roomSize,
      },
    };
  }

  private rawStateForRoom(roomId: string): RoomLiveState {
    const room = this.rooms.get(roomId);
    if (roomId === FM_ROOM_ID || String(room?.room.fixtureId) === FM_FIXTURE_ID) {
      const beat = this.presentedBeat(roomId);
      const fixtureOnly = roomId === FM_ROOM_ID
        ? beat
        : {
            ...beat,
            polls: [],
            notes: [],
            receipts: beat.receipts.filter((view) => view.receipt.subject.kind === "moment"),
          };
      return this.applyAnswers(fixtureOnly, roomId);
    }
    return this.staticState(roomId);
  }

  private stateForRoom(roomId: string): RoomLiveState {
    const state = this.rawStateForRoom(roomId);
    const members = this.memberViews(roomId);
    const items = this.buildRoomItems(roomId, state);
    const viewerId = this.session?.userId;
    const cursorKey = `${roomId}:${viewerId ?? "guest"}`;
    const savedCursor = this.readCursors.get(cursorKey);
    const savedIndex = savedCursor ? items.findIndex((item) => item.id === savedCursor) : -1;
    const hasSavedCursor = savedIndex >= 0;
    const unreadPool = items
      .slice(savedIndex + 1)
      .filter((item) => item.author?.isCurrentUser !== true);
    const unreadItems = hasSavedCursor ? unreadPool : unreadPool.slice(-3);
    const firstUnread = unreadItems[0]?.id ?? null;
    const firstUnreadIndex = firstUnread ? items.findIndex((item) => item.id === firstUnread) : -1;
    const derivedLastRead = hasSavedCursor
      ? savedCursor!
      : (firstUnreadIndex > 0 ? String(items[firstUnreadIndex - 1]!.id) : null);
    const latestItemId = items.at(-1)?.id ?? null;
    const customPolls = items
      .filter((item): item is PollFeedItem => item.kind === "poll")
      .map((item) => item.poll)
      .filter((poll) => !state.polls.some((existing) => existing.id === poll.id));
    return {
      ...state,
      polls: [...state.polls.map((poll) => this.pollWithVotes(roomId, poll)), ...customPolls],
      items,
      members,
      typingUsers:
        state.phase === "live"
          ? members.filter((member) => member.isOnline && !member.isCurrentUser).slice(0, 1)
          : [],
      unreadState: {
        count: unreadItems.length,
        firstUnreadItemId: firstUnread,
        lastReadItemId: derivedLastRead ? asRoomItemId(derivedLastRead) : null,
        isAtLiveEdge: unreadItems.length === 0 || (hasSavedCursor && savedCursor === latestItemId),
      },
    };
  }

  private hasReadAccess(room: StoredRoom): boolean {
    if (room.room.type !== "private") return true;
    return Boolean(this.session && room.members.has(this.session.userId));
  }

  private requireReadAccess(roomId: string): StoredRoom {
    if (!this.rooms.has(roomId) && !SEED_BY_ROOM.has(roomId)) throw new Error("Room not found");
    const room = this.ensureRoomRecord(roomId);
    if (!this.hasReadAccess(room)) throw new Error("Join this invite-only room to continue");
    return room;
  }

  private staticState(roomId: string): RoomLiveState {
    const room = this.rooms.get(roomId);
    const seed = room
      ? SEED_BY_FIXTURE.get(String(room.room.fixtureId))
      : SEED_BY_ROOM.get(roomId);
    const status = seed?.fixture.status ?? "scheduled";
    return {
      fixtureState: {
        fixtureId: (seed?.fixture.id ?? "0") as RoomLiveState["fixtureState"]["fixtureId"],
        status,
        minute: seed?.minute ?? null,
        score: seed?.score ?? { home: 0, away: 0 },
        lastFeedTs: null,
        lastMessageId: null,
        gaps: [],
      },
      phase: phaseOf(status),
      crowd: seed ? Math.round(300 + Number(seed.fixture.id) * 7) : 0,
      timeline: [],
      calls: [],
      marketSays: [],
      polls: [],
      notes: [],
      receipts: [],
      fanIq: { fanIq: 0, accuracy: 0, scoredCalls: 0, correctCalls: 0, roomRank: 0, roomSize: seed ? 400 : 0 },
      items: [],
      members: [],
      typingUsers: [],
      unreadState: {
        count: 0,
        firstUnreadItemId: null,
        lastReadItemId: null,
        isAtLiveEdge: true,
      },
      pressure: 0.3,
      lastEventId: null,
    };
  }

  private memberViews(roomId: string): RoomMemberView[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.members.values()]
      .map((member) => ({
        ...member,
        isCurrentUser: member.userId === this.session?.userId,
        successfulInvites: this.influenceJoins.get(member.userId)?.size ?? 0,
      }))
      .sort((a, b) => {
        const roles: Record<RoomMemberRole, number> = { creator: 0, moderator: 1, member: 2 };
        return roles[a.role] - roles[b.role] || a.displayName.localeCompare(b.displayName);
      });
  }

  private authorFor(roomId: string, userId: string, fallbackName = "FullTime"): RoomItemAuthor {
    const member = this.rooms.get(roomId)?.members.get(userId);
    return {
      userId: asUserId(userId),
      displayName: member?.displayName ?? fallbackName,
      role: member?.role ?? "member",
      isCurrentUser: userId === this.session?.userId,
    };
  }

  private feedBase(
    roomId: string | RoomId,
    id: string,
    createdAt: number | WallClock,
    options: {
      feedTs?: number;
      matchMinute?: number | null;
      author?: RoomItemAuthor;
      reactions?: ReactionSummary[];
    } = {},
  ): FeedBaseFields {
    const roomKey = String(roomId);
    const feedTs = options.feedTs === undefined ? undefined : asFeedTimestamp(options.feedTs);
    const safeRelease = feedTs
      ? releaseAt(feedTs, this.calibrations.get(this.calibrationKey(roomKey))?.delaySeconds ?? 0)
      : asWallClock(Number(createdAt));
    return {
      id: asRoomItemId(id),
      roomId: roomKey as RoomId,
      releaseAt: safeRelease,
      createdAt: asWallClock(Number(createdAt)),
      ...(feedTs ? { feedTs } : {}),
      ...(options.matchMinute !== undefined ? { matchMinute: options.matchMinute } : {}),
      ...(options.author ? { author: options.author } : {}),
      reactions: options.reactions ?? [],
      replies: [],
      replyCount: 0,
      permalink: `/room/${roomKey}?item=${encodeURIComponent(id)}`,
    };
  }

  private systemItem(
    roomId: string | RoomId,
    text: string,
    tone: "info" | "warning" | "success",
    createdAt: number | WallClock,
    id = `item-system-${String(createdAt)}`,
    noticeType?: "member-joined",
  ): RoomFeedItem {
    return {
      ...this.feedBase(roomId, id, createdAt),
      kind: "system",
      text,
      tone,
      ...(noticeType ? { noticeType } : {}),
    };
  }

  private socializedItem(item: RoomFeedItem): RoomFeedItem {
    const currentUserId = this.session?.userId;
    const reactionsAllowed = item.kind === "text" || item.kind === "image" || item.kind === "event";
    const reactionMap = new Map(item.reactions.map((reaction) => [reaction.emoji, { ...reaction }]));
    const prefix = `${item.roomId}:${item.id}:`;
    if (reactionsAllowed) {
      for (const [key, users] of this.reactions) {
        if (!key.startsWith(prefix)) continue;
        const emoji = key.slice(prefix.length);
        const existing = reactionMap.get(emoji);
        reactionMap.set(emoji, {
          emoji,
          count: (existing?.count ?? 0) + users.size,
          reactedByMe: currentUserId ? users.has(currentUserId) : false,
        });
      }
    }
    const replies = orderThreadReplies(this.replies.get(`${item.roomId}:${item.id}`) ?? []).map((reply) => ({
      ...reply,
      author: {
        ...reply.author,
        isCurrentUser: reply.author.userId === currentUserId,
      },
    }));
    return {
      ...item,
      ...(item.author
        ? {
            author: {
              ...item.author,
              isCurrentUser: item.author.userId === currentUserId,
            },
          }
        : {}),
      reactions: reactionsAllowed
        ? [...reactionMap.values()].sort((a, b) => a.emoji.localeCompare(b.emoji))
        : [],
      replies,
      replyCount: replies.length,
    };
  }

  private matchMinute(roomId: string, timestamp: number): number | null {
    const room = this.rooms.get(roomId);
    const seed = room
      ? SEED_BY_FIXTURE.get(String(room.room.fixtureId))
      : SEED_BY_ROOM.get(roomId);
    if (!seed) return null;
    return Math.max(0, Math.round((timestamp - Number(seed.fixture.kickoff)) / 60_000));
  }

  private pollWithVotes(roomId: string, poll: Poll): Poll {
    const counts = new Map<string, number>();
    const prefix = `${roomId}:${poll.id}:`;
    for (const [key, option] of this.pollVotes) {
      if (key.startsWith(prefix)) counts.set(option, (counts.get(option) ?? 0) + 1);
    }
    return {
      ...poll,
      options: poll.options.map((option) => ({
        ...option,
        votes: option.votes + (counts.get(option.id) ?? 0),
      })),
    };
  }

  private myPollVote(roomId: string, pollId: string): string | undefined {
    const userId = this.session?.userId;
    return userId ? this.pollVotes.get(`${roomId}:${pollId}:${userId}`) : undefined;
  }

  private buildRoomItems(roomId: string, state: RoomLiveState): RoomFeedItem[] {
    const currentFeedTs = state.fixtureState.lastFeedTs;
    const delaySeconds = this.calibrations.get(this.calibrationKey(roomId))?.delaySeconds ?? 0;
    const items: RoomFeedItem[] = (this.customItems.get(roomId) ?? [])
      .filter((item) =>
        item.feedTs === undefined
          || (currentFeedTs !== null && Number(item.feedTs) <= Number(currentFeedTs)),
      )
      .map((item): RoomFeedItem =>
        item.feedTs === undefined
          ? item
          : { ...item, releaseAt: releaseAt(item.feedTs, delaySeconds) },
      )
      .map((item) => {
        if (item.kind !== "poll") return item;
        const myVote = this.myPollVote(roomId, item.poll.id);
        return {
          ...item,
          poll: this.pollWithVotes(roomId, item.poll),
          ...(myVote ? { myVote } : {}),
        };
      });
    for (const timeline of state.timeline) {
      const baseReactions = (timeline.reactions ?? []).map((reaction) => ({
        ...reaction,
        reactedByMe: false,
      }));
      if (timeline.event) {
        items.push({
          ...this.feedBase(roomId, `item-event-${timeline.event.id}`, timeline.event.feedTs, {
            feedTs: timeline.event.feedTs,
            matchMinute: timeline.event.minute,
            reactions: baseReactions,
          }),
          kind: "event",
          event: timeline.event,
          label: timeline.label,
        });
      } else {
        items.push({
          ...this.feedBase(roomId, `item-timeline-${timeline.id}`, timeline.feedTs, {
            feedTs: timeline.feedTs,
            matchMinute: this.matchMinute(roomId, timeline.feedTs),
            reactions: baseReactions,
          }),
          kind: "system",
          text: timeline.detail ? `${timeline.label} — ${timeline.detail}` : timeline.label,
          tone: timeline.kind === "phase" ? "warning" : "info",
        });
      }
    }
    for (const view of state.calls) {
      items.push({
        ...this.feedBase(roomId, `item-call-${view.call.id}`, view.call.openedAt, {
          feedTs: view.call.openedAt,
          matchMinute: this.matchMinute(roomId, view.call.openedAt),
        }),
        kind: "call",
        call: view,
      });
    }
    for (const marketSays of state.marketSays) {
      items.push({
        ...this.feedBase(roomId, `item-odds-${marketSays.id}`, marketSays.feedTs, {
          feedTs: marketSays.feedTs,
          matchMinute: this.matchMinute(roomId, marketSays.feedTs),
        }),
        kind: "odds",
        marketSays,
      });
    }
    for (const poll of state.polls) {
      const voted = this.pollWithVotes(roomId, poll);
      const myVote = this.myPollVote(roomId, poll.id);
      items.push({
        ...this.feedBase(roomId, `item-poll-${poll.id}`, poll.createdAt, {
          author: this.authorFor(roomId, "u-amina", "Amina"),
        }),
        kind: "poll",
        poll: voted,
        ...(myVote ? { myVote } : {}),
      });
    }
    const fixtureKickoff = Number(
      SEED_BY_FIXTURE.get(String(state.fixtureState.fixtureId))?.fixture.kickoff ?? 0,
    );
    const safeFeedCutoff = Number(state.fixtureState.lastFeedTs ?? fixtureKickoff);
    const releasedItems = items.filter(
      (item) => item.kind !== "receipt"
        && (item.feedTs === undefined || Number(item.feedTs) <= safeFeedCutoff),
    );
    return orderRoomFeedItems(releasedItems.map((item) => this.socializedItem(item)));
  }

  async getRoomState(roomId: string): Promise<RoomLiveState> {
    this.requireReadAccess(roomId);
    return delay(this.stateForRoom(roomId), 120);
  }

  subscribeRoomState(roomId: string, onState: (s: RoomLiveState) => void): () => void {
    this.requireReadAccess(roomId);
    let set = this.subscribers.get(roomId);
    if (!set) {
      set = new Set();
      this.subscribers.set(roomId, set);
    }
    set.add(onState);
    onState(this.stateForRoom(roomId));
    this.ensureTimer();
    this.scheduleNextRelease(roomId);
    return () => {
      set!.delete(onState);
      if (set!.size === 0) {
        this.subscribers.delete(roomId);
        const releaseTimer = this.releaseTimers.get(roomId);
        if (releaseTimer) clearTimeout(releaseTimer);
        this.releaseTimers.delete(roomId);
      }
      if (this.subscribers.size === 0) this.stopTimer();
    };
  }

  private ensureTimer(): void {
    if (this.timer || typeof window === "undefined") return;
    this.timer = setInterval(() => {
      if (this.autoplay && this.beatIndex < this.beats.length - 1) {
        this.beatIndex += 1;
        this.resetPresentationClock();
        this.emit();
      }
    }, AUTOPLAY_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const releaseTimer of this.releaseTimers.values()) clearTimeout(releaseTimer);
    this.releaseTimers.clear();
  }

  private scheduleNextRelease(roomId: string): void {
    if (typeof window === "undefined" || !this.subscribers.has(roomId)) return;
    const existing = this.releaseTimers.get(roomId);
    if (existing) clearTimeout(existing);
    const delayMs = (this.calibrations.get(this.calibrationKey(roomId))?.delaySeconds ?? 0) * 1_000;
    const now = this.presentationNow();
    let nextInMs = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= this.beatIndex; index += 1) {
      const feedTs = this.beats[index]!.state.fixtureState.lastFeedTs;
      if (feedTs === null) continue;
      const remaining = Number(feedTs) + delayMs - now;
      if (remaining > 0) nextInMs = Math.min(nextInMs, remaining);
    }
    if (!Number.isFinite(nextInMs)) {
      this.releaseTimers.delete(roomId);
      return;
    }
    const timer = setTimeout(() => {
      this.releaseTimers.delete(roomId);
      this.emitRoom(roomId);
    }, Math.max(1, Math.ceil(nextInMs)));
    this.releaseTimers.set(roomId, timer);
  }

  private emit(): void {
    for (const [roomId, set] of this.subscribers) {
      const room = this.rooms.get(roomId);
      if (room && !this.hasReadAccess(room)) continue;
      const state = this.stateForRoom(roomId);
      for (const cb of set) cb(state);
      this.scheduleNextRelease(roomId);
    }
  }

  private emitRoom(roomId: string): void {
    const set = this.subscribers.get(roomId);
    if (!set) return;
    const room = this.rooms.get(roomId);
    if (room && !this.hasReadAccess(room)) return;
    const state = this.stateForRoom(roomId);
    for (const cb of set) cb(state);
    this.scheduleNextRelease(roomId);
  }

  // --- Writes ---

  private requireSession(): Session {
    if (!this.session) throw new Error("Sign in to continue");
    return this.session;
  }

  private requireKnownMembership(roomId: string): { room: StoredRoom; member: StoredMember } {
    const session = this.requireSession();
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    const member = room.members.get(session.userId);
    if (!member) throw new Error("Join the room before posting");
    return { room, member };
  }

  private requireMembership(roomId: string): { room: StoredRoom; member: StoredMember } {
    const membership = this.requireKnownMembership(roomId);
    const { room } = membership;
    if (room.isClosed) throw new Error("Room is closed");
    return membership;
  }

  private requireCreator(roomId: string): { room: StoredRoom; member: StoredMember } {
    const membership = this.requireMembership(roomId);
    if (membership.member.role !== "creator") throw new Error("Only the room creator can do that");
    return membership;
  }

  private enforceSlowMode(room: StoredRoom, member: StoredMember): void {
    if (room.slowModeSeconds <= 0) return;
    const lastPost = this.lastPosts.get(`${room.room.id}:${member.userId}`);
    if (lastPost === undefined) return;
    const remainingMs = room.slowModeSeconds * 1_000 - (Date.now() - lastPost);
    if (remainingMs > 0) throw new Error(`Slow mode: wait ${Math.ceil(remainingMs / 1_000)} seconds`);
  }

  private markPosted(room: StoredRoom, member: StoredMember): void {
    this.lastPosts.set(`${room.room.id}:${member.userId}`, Date.now());
  }

  private findRoomItem(roomId: string, itemId: string): RoomFeedItem | null {
    return this.buildRoomItems(roomId, this.rawStateForRoom(roomId)).find((item) => {
      if (item.id === itemId) return true;
      if (item.kind === "event" && item.event.id === itemId) return true;
      if (item.kind === "call" && item.call.call.id === itemId) return true;
      if (item.kind === "poll" && item.poll.id === itemId) return true;
      if (item.kind === "receipt" && item.receipt.receipt.id === itemId) return true;
      return false;
    }) ?? null;
  }

  async submitAnswer(roomId: string, callId: string, option: string): Promise<void> {
    const { member } = this.requireMembership(roomId);
    const view = this.rawStateForRoom(roomId).calls.find((candidate) => candidate.call.id === callId);
    if (!view) throw new Error("Call not found");
    if (view.call.status !== "open") throw new Error("This call is no longer open");
    if (!view.call.options.some((candidate) => candidate.id === option)) throw new Error("Call option not found");
    this.answers.set(this.answerKey(member.userId, view), option);
    this.emitRoom(roomId);
    return delay(undefined, 60);
  }

  async sendReaction(roomId: string, emoji: string, anchorId: string): Promise<void> {
    const item = this.findRoomItem(roomId, anchorId);
    if (!item) throw new Error("Room item not found");
    return this.reactToItem(roomId, item.id, emoji);
  }

  async sendNote(roomId: string, text: string): Promise<void> {
    await this.sendMessage(roomId, { text });
  }

  async votePoll(roomId: string, pollId: string, option: string): Promise<void> {
    const { member } = this.requireMembership(roomId);
    const item = this.findRoomItem(roomId, pollId);
    if (!item || item.kind !== "poll") throw new Error("Poll not found");
    if (!item.poll.options.some((candidate) => candidate.id === option)) throw new Error("Poll option not found");
    this.pollVotes.set(`${roomId}:${pollId}:${member.userId}`, option);
    this.emitRoom(roomId);
    return delay(undefined, 60);
  }

  async sendMessage(roomId: string, input: SendMessageInput): Promise<ChatMessage> {
    const { room, member } = this.requireMembership(roomId);
    const text = input.text?.trim() ?? "";
    if (!text && !input.attachment) throw new Error("Message cannot be empty");
    if (text.length > MAX_MESSAGE_LENGTH) throw new Error("Messages are limited to 1,000 characters");
    this.enforceSlowMode(room, member);
    this.messageCounter += 1;
    const serial = String(this.messageCounter).padStart(4, "0");
    const createdAt = this.nextClock(roomId);
    this.markPosted(room, member);
    const common = {
      ...this.feedBase(roomId, `item-message-${serial}`, createdAt, {
        author: this.authorFor(roomId, member.userId, member.displayName),
      }),
      messageId: asMessageId(`msg-local-${serial}`),
    };
    const message: ChatMessage = input.attachment
      ? {
          ...common,
          kind: "image",
          ...(text ? { caption: text } : {}),
          attachment: { ...input.attachment },
        }
      : { ...common, kind: "text", text };
    const items = this.customItems.get(roomId) ?? [];
    items.push(message);
    this.customItems.set(roomId, items);
    this.emitRoom(roomId);
    return delay(this.socializedItem(message) as ChatMessage, 60);
  }

  async createPoll(roomId: string, input: CreatePollInput): Promise<PollFeedItem> {
    const { room, member } = this.requireMembership(roomId);
    const question = input.question.trim();
    const labels = input.options.map((option) => option.trim()).filter(Boolean);
    if (!question) throw new Error("Poll question is required");
    if (labels.length < 2 || labels.length > 4) throw new Error("Polls need between 2 and 4 options");
    if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
      throw new Error("Poll options must be unique");
    }
    this.enforceSlowMode(room, member);
    this.pollCounter += 1;
    const serial = String(this.pollCounter).padStart(4, "0");
    const createdAt = this.nextClock(roomId);
    this.markPosted(room, member);
    const poll: Poll = {
      id: `poll-local-${serial}` as Poll["id"],
      roomId: roomId as RoomId,
      question,
      options: labels.map((label, index) => ({ id: `option-${index + 1}`, label, votes: 0 })),
      scored: false,
      createdAt,
    };
    const item: PollFeedItem = {
      ...this.feedBase(roomId, `item-poll-${poll.id}`, createdAt, {
        author: this.authorFor(roomId, member.userId, member.displayName),
      }),
      kind: "poll",
      poll,
    };
    const items = this.customItems.get(roomId) ?? [];
    items.push(item);
    this.customItems.set(roomId, items);
    this.emitRoom(roomId);
    return delay(this.socializedItem(item) as PollFeedItem, 60);
  }

  async reactToItem(roomId: string, itemId: string, emoji: string): Promise<void> {
    const { member } = this.requireMembership(roomId);
    if (!emoji.trim()) throw new Error("Reaction cannot be empty");
    const item = this.findRoomItem(roomId, itemId);
    if (!item) throw new Error("Room item not found");
    if (item.kind !== "text" && item.kind !== "image" && item.kind !== "event") {
      throw new Error("Reactions are only available on messages and match events");
    }
    const key = `${roomId}:${item.id}:${emoji}`;
    let users = this.reactions.get(key);
    if (!users) {
      users = new Set();
      this.reactions.set(key, users);
    }
    // Idempotent add: retries and double taps by one account never inflate counts.
    users.add(member.userId);
    this.emitRoom(roomId);
    return delay(undefined, 40);
  }

  async sendReply(roomId: string, itemId: string, input: SendReplyInput): Promise<ThreadReply> {
    const { room, member } = this.requireMembership(roomId);
    const text = input.text.trim();
    if (!text) throw new Error("Reply cannot be empty");
    if (text.length > MAX_MESSAGE_LENGTH) throw new Error("Replies are limited to 1,000 characters");
    const item = this.findRoomItem(roomId, itemId);
    if (!item) throw new Error("Room item not found");
    this.enforceSlowMode(room, member);
    this.replyCounter += 1;
    const serial = String(this.replyCounter).padStart(4, "0");
    const createdAt = this.nextClock(roomId);
    this.markPosted(room, member);
    const reply: ThreadReply = {
      id: asMessageId(`reply-local-${serial}`),
      itemId: item.id,
      roomId: roomId as RoomId,
      author: this.authorFor(roomId, member.userId, member.displayName),
      text,
      createdAt,
      reactions: [],
    };
    const key = `${roomId}:${item.id}`;
    const replies = this.replies.get(key) ?? [];
    replies.push(reply);
    this.replies.set(key, orderThreadReplies(replies));
    this.emitRoom(roomId);
    return delay(reply, 60);
  }

  async markRoomRead(roomId: string, itemId: string): Promise<void> {
    const { member } = this.requireKnownMembership(roomId);
    const items = this.buildRoomItems(roomId, this.rawStateForRoom(roomId));
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("Room item not found");
    this.readCursors.set(`${roomId}:${member.userId}`, String(item.id));
    this.emitRoom(roomId);
    return delay(undefined, 20);
  }

  private influenceFor(userId: string): InfluenceView {
    const joins = this.influenceJoins.get(userId)?.size ?? 0;
    const thresholds = [0, 1, 3, 7, 15] as const;
    let level = 1;
    while (level < thresholds.length && joins >= thresholds[level]!) level += 1;
    const floor = thresholds[level - 1] ?? 0;
    const next = thresholds[level] ?? null;
    return {
      score: joins * 100,
      level,
      successfulJoins: joins,
      nextLevelAt: next,
      progress: next === null ? 1 : Math.min(1, (joins - floor) / (next - floor)),
    };
  }

  async getRoomDetails(roomId: string): Promise<RoomDetailsView | null> {
    if (!this.rooms.has(roomId) && !SEED_BY_ROOM.has(roomId)) return delay(null);
    const room = this.ensureRoomRecord(roomId);
    if (!this.hasReadAccess(room)) return delay(null);
    const seed = SEED_BY_FIXTURE.get(String(room.room.fixtureId));
    if (!seed) return delay(null);
    const viewerId = this.session?.userId ?? "guest";
    const member = room.members.get(viewerId);
    const isCreator = member?.role === "creator";
    const invite = this.activeInvite(room);
    const raw = this.rawStateForRoom(roomId);
    const media = (this.customItems.get(roomId) ?? [])
      .filter((item): item is Extract<ChatMessage, { kind: "image" }> => item.kind === "image")
      .map((item) => item.attachment);
    return delay({
      room: { ...room.room },
      fixture: seed.fixture,
      members: this.memberViews(roomId),
      invite: invite ? this.inviteView(invite) : null,
      influence: this.influenceFor(viewerId),
      fanIq: raw.fanIq,
      notificationSettings: {
        ...(room.notificationSettings.get(viewerId) ?? DEFAULT_NOTIFICATIONS),
      },
      slowModeSeconds: room.slowModeSeconds,
      isClosed: room.isClosed,
      media,
      permissions: {
        canInvite: Boolean(member) && !room.isClosed && Boolean(invite),
        canRename: isCreator && !room.isClosed,
        canRegenerateInvite: isCreator && !room.isClosed,
        canRevokeInvite: isCreator && !room.isClosed && Boolean(invite),
        canModerateMembers: isCreator && !room.isClosed,
        canSetSlowMode: isCreator && !room.isClosed,
        canCloseRoom: isCreator && !room.isClosed,
      },
    }, 60);
  }

  async createInvite(roomId: string): Promise<InviteView> {
    const { room, member } = this.requireMembership(roomId);
    let invite = this.activeInvite(room);
    if (!invite) {
      if (member.role !== "creator") throw new Error("Only the room creator can create a new invite");
      invite = this.makeInvite(room, member.userId);
    }
    return delay(this.inviteView(invite), 50);
  }

  async regenerateInvite(roomId: string): Promise<InviteView> {
    const { room, member } = this.requireCreator(roomId);
    const current = this.activeInvite(room);
    if (current) current.revokedAt = this.nextClock(roomId);
    const invite = this.makeInvite(room, member.userId);
    this.emitRoom(roomId);
    return delay(this.inviteView(invite), 50);
  }

  async revokeInvite(roomId: string): Promise<void> {
    const { room } = this.requireCreator(roomId);
    const invite = this.activeInvite(room);
    if (invite) invite.revokedAt = this.nextClock(roomId);
    room.activeInviteId = null;
    room.room = { ...room.room, inviteCode: undefined };
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async renameRoom(roomId: string, name: string): Promise<void> {
    const { room } = this.requireCreator(roomId);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new Error("Room name must be between 1 and 80 characters");
    room.room = { ...room.room, name: trimmed };
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    const { room } = this.requireCreator(roomId);
    const target = room.members.get(userId);
    if (!target) throw new Error("Member not found");
    if (target.role === "creator") throw new Error("The room creator cannot be removed");
    room.members.delete(userId);
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async setMemberRole(roomId: string, userId: string, role: "member" | "moderator"): Promise<void> {
    const { room } = this.requireCreator(roomId);
    const target = room.members.get(userId);
    if (!target) throw new Error("Member not found");
    if (target.role === "creator") throw new Error("The creator role cannot be changed");
    room.members.set(userId, { ...target, role });
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async setSlowMode(roomId: string, seconds: number): Promise<void> {
    const { room } = this.requireCreator(roomId);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) {
      throw new Error("Slow mode must be between 0 and 60 seconds");
    }
    room.slowModeSeconds = Math.round(seconds);
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async closeRoom(roomId: string): Promise<void> {
    const { room } = this.requireCreator(roomId);
    room.isClosed = true;
    const invite = this.activeInvite(room);
    if (invite) invite.revokedAt = this.nextClock(roomId);
    room.activeInviteId = null;
    room.room = { ...room.room, inviteCode: undefined };
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async updateNotificationSettings(
    roomId: string,
    settings: Partial<RoomNotificationSettings>,
  ): Promise<void> {
    const { room, member } = this.requireKnownMembership(roomId);
    room.notificationSettings.set(member.userId, {
      ...(room.notificationSettings.get(member.userId) ?? DEFAULT_NOTIFICATIONS),
      ...settings,
    });
    return delay(undefined, 40);
  }

  async leaveRoom(roomId: string): Promise<void> {
    const { room, member } = this.requireKnownMembership(roomId);
    if (member.role === "creator" && !room.isClosed) {
      throw new Error("Close the room before leaving");
    }
    room.members.delete(member.userId);
    this.emitRoom(roomId);
    return delay(undefined, 50);
  }

  async reportRoom(roomId: string, reason: string): Promise<void> {
    const session = this.requireSession();
    if (!reason.trim()) throw new Error("Report reason is required");
    if (!this.rooms.has(roomId)) throw new Error("Room not found");
    this.reports.add(`${roomId}:${session.userId}`);
    return delay(undefined, 50);
  }

  // --- Receipts / report / record / replay ---

  private allReceipts(): Map<string, ReceiptView> {
    const map = new Map<string, ReceiptView>();
    for (const beat of this.beats) {
      for (const view of beat.state.receipts) {
        const existing = map.get(String(view.receipt.id));
        if (!existing || view.receipt.state === "anchored") map.set(String(view.receipt.id), view);
      }
    }
    return map;
  }

  async getReceipt(receiptId: string): Promise<ReceiptView | null> {
    return delay(this.allReceipts().get(receiptId) ?? null);
  }

  async getReport(roomId: string): Promise<FanReportView | null> {
    if (!this.rooms.has(roomId) && !SEED_BY_ROOM.has(roomId)) return delay(null);
    const room = this.requireReadAccess(roomId);
    if (String(room.room.fixtureId) !== FM_FIXTURE_ID) return delay(null);
    const final = this.applyAnswers(this.beats[this.beats.length - 1]!.state, roomId);
    const fixture = SEED_BY_FIXTURE.get(String(room.room.fixtureId))?.fixture;
    if (!fixture) return delay(null);
    return delay(buildReport(final, this.displayName(), fixture));
  }

  async getRecord(): Promise<RecordView | null> {
    const userId = this.session?.userId;
    const roomIds = new Set<string>();
    if (userId && [...this.answers.keys()].some((key) => key.startsWith(`match:${userId}:`))) {
      roomIds.add(FM_ROOM_ID);
    }
    if (userId) {
      for (const [roomId, room] of this.rooms) {
        if (String(room.room.fixtureId) !== FM_FIXTURE_ID) continue;
        const roomPrefix = `room:${roomId}:${userId}:`;
        if ([...this.answers.keys()].some((key) => key.startsWith(roomPrefix))) roomIds.add(roomId);
      }
    }
    const finals = [...roomIds].map((roomId) =>
      this.applyAnswers(this.beats[this.beats.length - 1]!.state, roomId),
    );
    return delay(buildRecord(finals, this.displayName()));
  }

  async getReplay(fixtureId: string): Promise<ReplayView | null> {
    const seed = SEED_BY_FIXTURE.get(fixtureId);
    if (!seed || seed.roomId !== FM_ROOM_ID) return delay(null);
    const beats = this.beats.map((b) => b.state);
    const last = beats[beats.length - 1]!.fixtureState;
    return delay({
      fixture: seed.fixture,
      startFeedTs: Number(seed.fixture.kickoff),
      durationMs: Number(last.lastFeedTs ?? seed.fixture.kickoff) - Number(seed.fixture.kickoff),
      beats,
    });
  }

  // --- Session / calibration ---

  private displayName(): string {
    return this.session?.displayName ?? "You";
  }

  private calibrationKey(roomId: string, userId = this.session?.userId): string {
    return `${roomId}:${userId ?? "guest"}`;
  }

  async getSession(): Promise<Session | null> {
    return delay(this.session, 60);
  }

  async signIn(displayName: string): Promise<Session> {
    const session = this.activateSession(displayName);
    this.emit();
    return delay(session, 200);
  }

  async signOut(): Promise<void> {
    const userId = this.session?.userId;
    if (userId) {
      for (const room of this.rooms.values()) {
        const member = room.members.get(userId);
        if (member) room.members.set(userId, { ...member, isOnline: false });
      }
    }
    this.session = null;
    this.emit();
    return delay(undefined, 60);
  }

  async getCalibration(roomId: string): Promise<CalibrationView | null> {
    const session = this.requireSession();
    this.requireReadAccess(roomId);
    return delay(this.calibrations.get(this.calibrationKey(roomId, session.userId)) ?? null, 40);
  }

  async setCalibration(roomId: string, delaySeconds: number, method: CalibrationMethod): Promise<void> {
    const session = this.requireSession();
    this.requireReadAccess(roomId);
    this.calibrations.set(this.calibrationKey(roomId, session.userId), { delaySeconds, method });
    this.emitRoom(roomId);
    return delay(undefined, 40);
  }
}

function makeSession(displayName: string): Session {
  const cleanName = displayName.trim() || "You";
  const canonical = cleanName.normalize("NFKC").toLowerCase();
  const slug = cleanName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "you";
  let hash = 2_166_136_261;
  for (const character of canonical) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  const identity = canonical === slug ? slug : `${slug}-${(hash >>> 0).toString(36)}`;
  return {
    userId: `u-${identity}`,
    displayName: cleanName,
    walletAddress: `mock-${identity}`,
  };
}

function seedRoomItems(): RoomFeedItem[] {
  const roomId = FM_ROOM_ID as RoomId;
  const matchAt = (minute: number, seconds = 0): number =>
    FM_KICKOFF_MS + minute * 60_000 + seconds * 1_000;
  const author = (userId: string, displayName: string, role: RoomMemberRole): RoomItemAuthor => ({
    userId: asUserId(userId),
    displayName,
    role,
    isCurrentUser: false,
  });
  const base = (
    id: string,
    createdAt: number,
    itemAuthor?: RoomItemAuthor,
    anchor?: { minute: number; feedTs?: number },
  ): FeedBaseFields => ({
    id: asRoomItemId(id),
    roomId,
    releaseAt: asWallClock(createdAt),
    createdAt: asWallClock(createdAt),
    ...(anchor
      ? {
          feedTs: asFeedTimestamp(anchor.feedTs ?? matchAt(anchor.minute)),
        }
      : {}),
    ...(itemAuthor ? { author: itemAuthor } : {}),
    reactions: [],
    replies: [],
    replyCount: 0,
    permalink: `/room/${FM_ROOM_ID}?item=${encodeURIComponent(id)}`,
  });
  const amina = author("u-amina", "Amina", "creator");
  const theo = author("u-theo", "Theo", "moderator");
  const jo = author("u-jo", "Jo", "member");
  const pollCreatedAt = FM_KICKOFF_MS - 4 * 60_000;
  const poll: Poll = {
    id: "poll-lineups" as Poll["id"],
    roomId,
    question: "First big chance comes from which side?",
    options: [
      { id: "france", label: "France", votes: 5 },
      { id: "morocco", label: "Morocco", votes: 3 },
    ],
    scored: false,
    createdAt: asWallClock(pollCreatedAt),
  };
  const attachment: MessageAttachment = {
    id: "attachment-tifo",
    type: "image",
    name: "away-end-tifo.svg",
    mimeType: "image/svg+xml",
    sizeBytes: 42_600,
    url: "/window.svg",
    status: "ready",
    progress: 1,
  };
  const halftimeAttachment: MessageAttachment = {
    id: "attachment-halftime-shape",
    type: "image",
    name: "france-morocco-first-half.png",
    mimeType: "image/png",
    sizeBytes: 188_400,
    url: "/images/fulltime-football-hero.png",
    status: "ready",
    progress: 1,
  };
  return [
    {
      ...base("item-system-welcome", FM_KICKOFF_MS - 15 * 60_000),
      kind: "system",
      text: "Invite-only room opened. Match updates follow your MatchSync delay.",
      tone: "info",
    },
    {
      ...base("item-message-welcome", FM_KICKOFF_MS - 11 * 60_000, amina),
      kind: "text",
      messageId: asMessageId("msg-seed-welcome"),
      text: "Welcome in. Morocco's left side is the matchup to watch tonight.",
      reactions: [{ emoji: "👀", count: 3, reactedByMe: false }],
    },
    {
      ...base("item-message-image", FM_KICKOFF_MS - 8 * 60_000, theo),
      kind: "image",
      messageId: asMessageId("msg-seed-image"),
      caption: "Away end is ready.",
      attachment,
      reactions: [{ emoji: "🔥", count: 6, reactedByMe: false }],
    },
    {
      ...base(`item-poll-${poll.id}`, pollCreatedAt, amina),
      kind: "poll",
      poll,
    },
    {
      ...base("item-message-kickoff", matchAt(0, 10), theo, { minute: 0 }),
      kind: "text",
      messageId: asMessageId("msg-seed-kickoff"),
      text: "That noise. We are properly under way now.",
      reactions: [
        { emoji: "🔥", count: 9, reactedByMe: false },
        { emoji: "👏", count: 4, reactedByMe: false },
      ],
    },
    {
      ...base("item-message-pressure", matchAt(12, 8), amina, { minute: 12 }),
      kind: "text",
      messageId: asMessageId("msg-seed-pressure"),
      text: "France keep finding the spare runner outside Morocco’s midfield. That first goal feels close.",
      editedAt: asWallClock(matchAt(12, 14)),
      reactions: [{ emoji: "👀", count: 8, reactedByMe: false }],
    },
    {
      ...base("item-message-france-goal", matchAt(23, 6), jo, { minute: 23 }),
      kind: "text",
      messageId: asMessageId("msg-seed-france-goal"),
      text: "I was still celebrating the pass before the finish. What a move.",
      reactions: [
        { emoji: "⚽", count: 14, reactedByMe: false },
        { emoji: "🔥", count: 18, reactedByMe: false },
      ],
    },
    {
      ...base("item-message-receipt", matchAt(26, 5), theo, { minute: 26 }),
      kind: "text",
      messageId: asMessageId("msg-seed-receipt"),
      text: "Goal receipt is anchored. The ‘before 30’ crowd can collect their bragging rights.",
      reactions: [{ emoji: "👏", count: 7, reactedByMe: false }],
    },
    {
      ...base("item-message-halftime-image", matchAt(45, 4), amina, { minute: 45 }),
      kind: "image",
      messageId: asMessageId("msg-seed-halftime-image"),
      caption: "First-half shape. Morocco have to make that left channel count now.",
      attachment: halftimeAttachment,
      reactions: [{ emoji: "👀", count: 11, reactedByMe: false }],
    },
    {
      ...base("item-message-morocco-push", matchAt(58, 5), theo, { minute: 58 }),
      kind: "text",
      messageId: asMessageId("msg-seed-morocco-push"),
      text: "Three at the back and both wing-backs high. Morocco are going for this.",
      reactions: [{ emoji: "😮", count: 5, reactedByMe: false }],
    },
    {
      ...base("item-message-morocco-goal", matchAt(67, 7), amina, { minute: 67 }),
      kind: "text",
      messageId: asMessageId("msg-seed-morocco-goal"),
      text: "There it is. The room called the pressure before the equaliser landed.",
      reactions: [
        { emoji: "⚽", count: 16, reactedByMe: false },
        { emoji: "😮", count: 12, reactedByMe: false },
      ],
    },
    {
      ...base("item-message-feed-gap", matchAt(78, 4), jo, { minute: 78 }),
      kind: "text",
      messageId: asMessageId("msg-seed-feed-gap"),
      text: "Fair void. If the feed missed the corner window, nobody should lose points on a guess.",
      reactions: [{ emoji: "👏", count: 6, reactedByMe: false }],
    },
    {
      ...base("item-message-penalty", matchAt(82, 5), theo, { minute: 82 }),
      kind: "text",
      messageId: asMessageId("msg-seed-penalty"),
      text: "Ice cold from the spot. Eight minutes to survive now.",
      reactions: [{ emoji: "🔥", count: 21, reactedByMe: false }],
    },
    {
      ...base("item-message-fulltime", matchAt(90, 5), amina, { minute: 90 }),
      kind: "text",
      messageId: asMessageId("msg-seed-fulltime"),
      text: "Full time. Check your report — the receipts tell the whole story.",
      reactions: [
        { emoji: "👏", count: 24, reactedByMe: false },
        { emoji: "🔥", count: 19, reactedByMe: false },
      ],
    },
  ];
}

function seedRoomReplies(): Array<[string, ThreadReply[]]> {
  const roomId = FM_ROOM_ID as RoomId;
  const matchAt = (minute: number, seconds = 0): WallClock =>
    asWallClock(FM_KICKOFF_MS + minute * 60_000 + seconds * 1_000);
  const author = (userId: string, displayName: string, role: RoomMemberRole): RoomItemAuthor => ({
    userId: asUserId(userId),
    displayName,
    role,
    isCurrentUser: false,
  });
  const amina = author("u-amina", "Amina", "creator");
  const theo = author("u-theo", "Theo", "moderator");
  const jo = author("u-jo", "Jo", "member");
  const reply = (
    id: string,
    itemId: string,
    replyAuthor: RoomItemAuthor,
    text: string,
    createdAt: WallClock,
    reactions: ReactionSummary[] = [],
  ): ThreadReply => ({
    id: asMessageId(id),
    itemId: asRoomItemId(itemId),
    roomId,
    author: replyAuthor,
    text,
    createdAt,
    reactions,
  });

  return [
    [
      "item-message-welcome",
      [
        reply("reply-seed-welcome-1", "item-message-welcome", theo, "Hakimi against that left side is the one for me.", matchAt(-10, 5)),
        reply("reply-seed-welcome-2", "item-message-welcome", jo, "And watch how quickly France switch it after turnovers.", matchAt(-10, 10)),
        reply("reply-seed-welcome-3", "item-message-welcome", amina, "Exactly. Pinning this so we can revisit it at half-time.", matchAt(-10, 15)),
      ],
    ],
    [
      "item-message-kickoff",
      [
        reply("reply-seed-kickoff-1", "item-message-kickoff", amina, "No easing into this one.", matchAt(0, 12)),
        reply("reply-seed-kickoff-2", "item-message-kickoff", jo, "Morocco pressed the first pass. Love it.", matchAt(0, 14)),
      ],
    ],
    [
      "item-call-call-score30",
      [
        reply("reply-seed-call-1", "item-call-call-score30", theo, "I’m on yes. The pressure number keeps climbing.", matchAt(12, 2)),
        reply("reply-seed-call-2", "item-call-call-score30", jo, "Same — France are arriving with too many runners.", matchAt(12, 4)),
      ],
    ],
    [
      "item-event-ev-goal-23",
      [
        reply("reply-seed-goal-1", "item-event-ev-goal-23", jo, "That first touch made the finish.", matchAt(23, 1)),
        reply("reply-seed-goal-2", "item-event-ev-goal-23", theo, "And the ‘before 30’ call settles immediately.", matchAt(23, 2)),
        reply("reply-seed-goal-3", "item-event-ev-goal-23", amina, "Receipt is pending — give the proof a minute to land.", matchAt(23, 3)),
      ],
    ],
    [
      "item-poll-poll-pressure",
      [
        reply("reply-seed-poll-1", "item-poll-poll-pressure", jo, "One goal is not enough with Morocco growing into it.", matchAt(26, 2)),
        reply("reply-seed-poll-2", "item-poll-poll-pressure", theo, "France need the next ten minutes to be boring.", matchAt(26, 3)),
      ],
    ],
    [
      "item-message-halftime-image",
      [
        reply("reply-seed-halftime-1", "item-message-halftime-image", theo, "That weak-side space is enormous in this frame.", matchAt(45, 6)),
        reply("reply-seed-halftime-2", "item-message-halftime-image", jo, "Morocco have to gamble on it now.", matchAt(45, 8)),
      ],
    ],
    [
      "item-message-morocco-push",
      [
        reply("reply-seed-push-1", "item-message-morocco-push", amina, "The room pressure meter agrees.", matchAt(58, 7)),
        reply("reply-seed-push-2", "item-message-morocco-push", jo, "France are defending the box already.", matchAt(58, 9)),
      ],
    ],
    [
      "item-event-ev-goal-67",
      [
        reply("reply-seed-equaliser-1", "item-event-ev-goal-67", amina, "That shape change paid off.", matchAt(67, 1)),
        reply("reply-seed-equaliser-2", "item-event-ev-goal-67", jo, "The next-goal call hurts, but that was deserved.", matchAt(67, 2)),
        reply("reply-seed-equaliser-3", "item-event-ev-goal-67", theo, "Now watch the draw price compress.", matchAt(67, 3)),
      ],
    ],
    [
      "item-message-feed-gap",
      [
        reply("reply-seed-gap-1", "item-message-feed-gap", amina, "Exactly. A void is a feature when the evidence is incomplete.", matchAt(78, 6)),
        reply("reply-seed-gap-2", "item-message-feed-gap", theo, "Calls can be fun without pretending uncertainty did not happen.", matchAt(78, 8)),
      ],
    ],
    [
      "item-message-penalty",
      [
        reply("reply-seed-penalty-1", "item-message-penalty", jo, "Could not have placed it better.", matchAt(82, 7)),
        reply("reply-seed-penalty-2", "item-message-penalty", amina, "Moment receipt is already pending.", matchAt(82, 9)),
      ],
    ],
    [
      "item-event-ev-full-time-90",
      [
        reply("reply-seed-fulltime-1", "item-event-ev-full-time-90", theo, "Two calls settled, one honest void. I’ll take it.", matchAt(90, 1)),
        reply("reply-seed-fulltime-2", "item-event-ev-full-time-90", jo, "That report is going straight in the group chat.", matchAt(90, 2)),
      ],
    ],
  ];
}

function settledCalls(state: RoomLiveState): CallView[] {
  return state.calls.filter((view) => view.settlement && view.myAnswer);
}

function toReportCall(view: CallView): ReportCall {
  const chosen = view.call.options.find((o) => o.id === view.myAnswer);
  return {
    callId: view.call.id,
    prompt: view.call.prompt,
    chosenLabel: chosen?.label ?? "—",
    outcome: view.outcome ?? "void",
    points: view.points ?? 0,
    receiptState: view.outcome === "void" ? "void" : "anchored",
    receiptId: view.receiptId,
    difficultyPct: view.call.difficulty ? Math.round(view.call.difficulty * 100) : undefined,
  };
}

function buildReport(
  final: RoomLiveState,
  displayName: string,
  fixture: FanReportView["fixture"],
): FanReportView {
  const calls = settledCalls(final).map(toReportCall);
  const scored = calls.filter((c) => c.outcome !== "void");
  const correct = scored.filter((c) => c.outcome === "correct");
  const best = [...correct].sort((a, b) => b.points - a.points)[0];
  const hardest = [...correct].sort((a, b) => (a.difficultyPct ?? 100) - (b.difficultyPct ?? 100))[0];
  const miss = scored.find((c) => c.outcome === "incorrect");
  return {
    displayName,
    fixture,
    finalScore: final.fixtureState.score,
    fanIq: final.fanIq.fanIq,
    accuracy: final.fanIq.accuracy,
    rank: final.fanIq.roomRank,
    roomSize: final.fanIq.roomSize,
    percentile: Math.max(1, Math.round(100 - (final.fanIq.roomRank / final.fanIq.roomSize) * 100)),
    scoredCalls: scored.length,
    ...(best ? { bestRead: best } : {}),
    ...(hardest ? { highestDifficultyHit: hardest } : {}),
    ...(miss ? { biggestMiss: miss } : {}),
    calls,
  };
}

function buildRecord(finals: RoomLiveState[], displayName: string): RecordView {
  const fmEntries = finals.flatMap((final) =>
    settledCalls(final)
      .filter((view) => view.myAnswer)
      .map((view) => {
        const rc = toReportCall(view);
        return {
          callId: rc.callId,
          fixtureLabel: "FRA vs MAR",
          homeCode: "FR",
          awayCode: "MA",
          prompt: rc.prompt,
          chosenLabel: rc.chosenLabel,
          outcome: rc.outcome,
          points: rc.points,
          receiptState: rc.receiptState,
          receiptId: rc.receiptId,
          minute: null,
        };
      }),
  );
  const priorEntries = [
    {
      callId: "rec-ger-1",
      fixtureLabel: "GER vs USA",
      homeCode: "DE",
      awayCode: "US",
      prompt: "Over 3.5 goals before full time?",
      chosenLabel: "Yes",
      outcome: "correct" as const,
      points: 190,
      receiptState: "anchored" as const,
      minute: 78,
    },
    {
      callId: "rec-ger-2",
      fixtureLabel: "GER vs USA",
      homeCode: "DE",
      awayCode: "US",
      prompt: "USA to score first?",
      chosenLabel: "Yes",
      outcome: "correct" as const,
      points: 240,
      receiptState: "anchored" as const,
      minute: 14,
    },
    {
      callId: "rec-cro-1",
      fixtureLabel: "CRO vs JPN",
      homeCode: "HR",
      awayCode: "JP",
      prompt: "Decided on penalties?",
      chosenLabel: "Yes",
      outcome: "correct" as const,
      points: 310,
      receiptState: "anchored" as const,
      minute: 120,
    },
  ];
  const entries = [...fmEntries, ...priorEntries];
  const scored = entries.filter((e) => e.outcome !== "void");
  const correct = scored.filter((e) => e.outcome === "correct").length;
  return {
    displayName,
    fanIq: finals.reduce((total, final) => total + final.fanIq.fanIq, 0) + 740,
    accuracy: scored.length ? correct / scored.length : 0,
    matchesPlayed: 3,
    totalCalls: entries.length,
    entries,
  };
}
