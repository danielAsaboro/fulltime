/**
 * Mock adapter — the default. Serves the deterministic France–Morocco scenario and
 * a spread of other fixtures so every UI state is designable and demoable without a
 * backend. The France–Morocco room plays the scenario beats (autoplay, or jumped to
 * a labelled state); user answers are applied live so settlement feels real.
 */

import type { CalibrationMethod } from "@fulltime/shared";

import type {
  CalibrationView,
  CallView,
  FanReportView,
  FixtureCard,
  FixturesFilter,
  FullTimeData,
  RecordView,
  ReplayView,
  ReceiptView,
  ReportCall,
  RoomLiveState,
  RoomPhase,
  RoomView,
  Session,
} from "../types";
import {
  FIXTURE_SEEDS,
  FM_INVITE_CODE,
  FM_ROOM_ID,
  SEED_BY_FIXTURE,
  SEED_BY_ROOM,
} from "./corpus";
import { buildFraMarBeats, SCENARIO_LABELS, type ScenarioLabel } from "./scenario";

const AUTOPLAY_INTERVAL_MS = 8_000;

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
  private timer: ReturnType<typeof setInterval> | null = null;

  configure(options: { scenario?: string | null; autoplay?: boolean }): void {
    const label = options.scenario as ScenarioLabel | null | undefined;
    if (label && SCENARIO_LABELS.includes(label)) {
      this.beatIndex = SCENARIO_LABELS.indexOf(label);
      this.autoplay = options.autoplay ?? false;
    } else if (options.autoplay !== undefined) {
      this.autoplay = options.autoplay;
    }
    this.emit();
  }

  get scenarioLabel(): ScenarioLabel {
    return SCENARIO_LABELS[this.beatIndex] ?? "kickoff";
  }

  jumpTo(label: ScenarioLabel): void {
    const idx = SCENARIO_LABELS.indexOf(label);
    if (idx >= 0) {
      this.beatIndex = idx;
      this.emit();
    }
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

  async getRoom(roomId: string): Promise<RoomView | null> {
    const seed = SEED_BY_ROOM.get(roomId);
    if (!seed) return delay(null);
    const card = this.cardFor(String(seed.fixture.id));
    return delay({
      room: {
        id: roomId as RoomView["room"]["id"],
        fixtureId: seed.fixture.id,
        type: "global",
        name: `${seed.fixture.home.name} vs ${seed.fixture.away.name}`,
        createdAt: seed.fixture.kickoff as unknown as RoomView["room"]["createdAt"],
      },
      fixture: seed.fixture,
      phase: card.phase,
      crowd: card.crowd,
      members: card.crowd,
    });
  }

  async getRoomByInvite(code: string): Promise<RoomView | null> {
    if (code.toUpperCase() !== FM_INVITE_CODE) return delay(null);
    const room = await this.getRoom(FM_ROOM_ID);
    if (!room) return null;
    return {
      ...room,
      room: { ...room.room, type: "private", name: "The Away End", inviteCode: FM_INVITE_CODE },
      inviteCode: FM_INVITE_CODE,
    };
  }

  // --- Live room state ---

  private currentBeat(): RoomLiveState {
    return this.beats[this.beatIndex]!.state;
  }

  private applyAnswers(state: RoomLiveState): RoomLiveState {
    if (this.answers.size === 0) return state;
    const calls = state.calls.map((view): CallView => {
      const answered = this.answers.get(view.call.id);
      if (!answered) return view;
      const tally = { ...view.tally, [answered]: (view.tally[answered] ?? 0) + 1 };
      let outcome = view.outcome;
      let points = view.points;
      if (view.settlement && view.settlement.outcome.status === "settled") {
        outcome = view.settlement.outcome.winningOption === answered ? "correct" : "incorrect";
        points = outcome === "correct" ? Math.round(100 / (view.call.difficulty ?? 0.5)) : 0;
      }
      return { ...view, myAnswer: answered, tally, total: view.total + 1, outcome, points };
    });
    return { ...state, calls };
  }

  private stateForRoom(roomId: string): RoomLiveState {
    if (roomId === FM_ROOM_ID) return this.applyAnswers(this.currentBeat());
    return this.staticState(roomId);
  }

  private staticState(roomId: string): RoomLiveState {
    const seed = SEED_BY_ROOM.get(roomId);
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
      pressure: 0.3,
      lastEventId: null,
    };
  }

  async getRoomState(roomId: string): Promise<RoomLiveState> {
    return delay(this.stateForRoom(roomId), 120);
  }

  subscribeRoomState(roomId: string, onState: (s: RoomLiveState) => void): () => void {
    let set = this.subscribers.get(roomId);
    if (!set) {
      set = new Set();
      this.subscribers.set(roomId, set);
    }
    set.add(onState);
    onState(this.stateForRoom(roomId));
    this.ensureTimer();
    return () => {
      set!.delete(onState);
      if (set!.size === 0) this.subscribers.delete(roomId);
      if (this.subscribers.size === 0) this.stopTimer();
    };
  }

  private ensureTimer(): void {
    if (this.timer || typeof window === "undefined") return;
    this.timer = setInterval(() => {
      if (this.autoplay && this.beatIndex < this.beats.length - 1) {
        this.beatIndex += 1;
        this.emit();
      }
    }, AUTOPLAY_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    for (const [roomId, set] of this.subscribers) {
      const state = this.stateForRoom(roomId);
      for (const cb of set) cb(state);
    }
  }

  // --- Writes ---

  async submitAnswer(_roomId: string, callId: string, option: string): Promise<void> {
    this.answers.set(callId, option);
    this.emit();
    return delay(undefined, 60);
  }

  async sendReaction(): Promise<void> {
    return delay(undefined, 40);
  }

  async sendNote(): Promise<void> {
    return delay(undefined, 60);
  }

  async votePoll(): Promise<void> {
    return delay(undefined, 60);
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
    if (roomId !== FM_ROOM_ID) return delay(null);
    const final = this.applyAnswers(this.beats[this.beats.length - 1]!.state);
    return delay(buildReport(final, this.displayName()));
  }

  async getRecord(): Promise<RecordView | null> {
    const final = this.applyAnswers(this.beats[this.beats.length - 1]!.state);
    return delay(buildRecord(final, this.displayName()));
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

  async getSession(): Promise<Session | null> {
    return delay(this.session, 60);
  }

  async signIn(displayName: string): Promise<Session> {
    this.session = {
      userId: "u-you",
      displayName: displayName.trim() || "You",
      walletAddress: "8Kx…demo",
    };
    return delay(this.session, 200);
  }

  async signOut(): Promise<void> {
    this.session = null;
    return delay(undefined, 60);
  }

  async getCalibration(roomId: string): Promise<CalibrationView | null> {
    return delay(this.calibrations.get(roomId) ?? null, 40);
  }

  async setCalibration(roomId: string, delaySeconds: number, method: CalibrationMethod): Promise<void> {
    this.calibrations.set(roomId, { delaySeconds, method });
    return delay(undefined, 40);
  }
}

function settledCalls(state: RoomLiveState): CallView[] {
  return state.calls.filter((c) => c.settlement);
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

function buildReport(final: RoomLiveState, displayName: string): FanReportView {
  const calls = settledCalls(final).map(toReportCall);
  const scored = calls.filter((c) => c.outcome !== "void");
  const correct = scored.filter((c) => c.outcome === "correct");
  const best = [...correct].sort((a, b) => b.points - a.points)[0];
  const hardest = [...correct].sort((a, b) => (a.difficultyPct ?? 100) - (b.difficultyPct ?? 100))[0];
  const miss = scored.find((c) => c.outcome === "incorrect");
  return {
    displayName,
    fixture: SEED_BY_ROOM.get(FM_ROOM_ID)!.fixture,
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

function buildRecord(final: RoomLiveState, displayName: string): RecordView {
  const fmEntries = settledCalls(final).map((view) => {
    const rc = toReportCall(view);
    return {
      callId: rc.callId,
      fixtureLabel: "FRA vs MAR",
      prompt: rc.prompt,
      chosenLabel: rc.chosenLabel,
      outcome: rc.outcome,
      points: rc.points,
      receiptState: rc.receiptState,
      receiptId: rc.receiptId,
      minute: null,
    };
  });
  const priorEntries = [
    {
      callId: "rec-ger-1",
      fixtureLabel: "GER vs USA",
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
    fanIq: final.fanIq.fanIq + 740,
    accuracy: scored.length ? correct / scored.length : 0,
    matchesPlayed: 3,
    totalCalls: entries.length,
    entries,
  };
}
