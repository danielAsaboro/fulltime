/**
 * Fixture state machine. Folds seq-ordered scores updates into a `FixtureState`,
 * emits phase-transition events (kickoff/half-time/full-time/…) on status change,
 * and records feed gaps when the sequence jumps — the gaps that later void any call
 * whose settlement window crossed them.
 *
 * Idempotent: a repeated or stale seq is ignored (no state change, no events), so
 * replaying the same corpus yields the same fold.
 */

import {
  asMatchEventId,
  type FeedGap,
  type FixtureId,
  type FixtureState,
  type MatchEvent,
  type MatchEventKind,
} from "@fulltime/shared";

import type { NormalizedScore } from "../txline/scores.js";

const PHASE_EVENT_BY_CODE: Record<number, MatchEventKind> = {
  2: "kickoff",
  3: "half-time",
  4: "second-half-start",
  5: "end-of-regulation",
  7: "extra-time-start",
  12: "penalty-shootout-start",
  15: "abandoned",
  16: "abandoned",
  17: "abandoned",
  18: "abandoned",
  19: "abandoned",
  100: "full-time",
};

const TERMINAL_STATUSES = new Set(["full-time", "abandoned", "postponed", "cancelled"]);

// TxLINE amendments can repeat an incident with an obsolete phase StatusId.
// Phase progression is monotonic; accepting a stale H1 status after H2 would
// manufacture another kickoff and second-half transition during replay/live ingest.
const STATUS_PHASE_ORDER: Record<number, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
  9: 8,
  10: 9,
  11: 10,
  12: 11,
  13: 12,
  100: 13,
};

function isPhaseRegression(previous: number | null, next: number | null): boolean {
  if (previous === null || next === null) return false;
  const previousOrder = STATUS_PHASE_ORDER[previous];
  const nextOrder = STATUS_PHASE_ORDER[next];
  return previousOrder !== undefined && nextOrder !== undefined && nextOrder < previousOrder;
}

export interface FixtureStepResult {
  state: FixtureState;
  events: MatchEvent[];
  duplicate: boolean;
  outOfOrder: boolean;
  gap: FeedGap | null;
}

export interface FixtureMachineCheckpoint {
  state: FixtureState;
  lastSeq: number;
  lastStatusCode: number | null;
}

function initialState(fixtureId: FixtureId): FixtureState {
  return {
    fixtureId,
    status: "scheduled",
    minute: null,
    score: { home: 0, away: 0 },
    lastFeedTs: null,
    lastMessageId: null,
    gaps: [],
  };
}

export class FixtureMachine {
  private state: FixtureState;
  private lastSeq: number | null = null;
  private lastStatusCode: number | null = null;

  constructor(fixtureId: FixtureId, checkpoint?: FixtureMachineCheckpoint) {
    if (checkpoint) {
      if (checkpoint.state.fixtureId !== fixtureId) throw new Error("Fixture checkpoint ID does not match");
      if (!Number.isSafeInteger(checkpoint.lastSeq) || checkpoint.lastSeq < 0) {
        throw new Error("Fixture checkpoint sequence is invalid");
      }
      if (checkpoint.lastStatusCode !== null && !Number.isSafeInteger(checkpoint.lastStatusCode)) {
        throw new Error("Fixture checkpoint status is invalid");
      }
      this.state = { ...checkpoint.state, gaps: [...checkpoint.state.gaps] };
      this.lastSeq = checkpoint.lastSeq;
      this.lastStatusCode = checkpoint.lastStatusCode;
    } else {
      this.state = initialState(fixtureId);
    }
  }

  get snapshot(): FixtureState {
    return this.state;
  }

  step(update: NormalizedScore): FixtureStepResult {
    if (this.lastSeq !== null && update.seq <= this.lastSeq) {
      return {
        state: this.state,
        events: [],
        duplicate: update.seq === this.lastSeq,
        outOfOrder: update.seq < this.lastSeq,
        gap: null,
      };
    }

    const gap = this.detectGap(update);
    const terminalRegression = TERMINAL_STATUSES.has(this.state.status) && !TERMINAL_STATUSES.has(update.status);
    const phaseRegression = isPhaseRegression(this.lastStatusCode, update.statusCode);
    const preservePhase = terminalRegression || phaseRegression;
    const events = terminalRegression
      ? []
      : [...(phaseRegression ? [] : this.phaseEvents(update)), ...update.incidents];

    this.state = {
      ...this.state,
      status: preservePhase ? this.state.status : update.status,
      minute: update.minute ?? this.state.minute,
      score: update.hasScore ? update.score : this.state.score,
      lastFeedTs: update.feedTs,
      lastMessageId: update.messageId,
      gaps: gap ? [...this.state.gaps, gap] : this.state.gaps,
    };
    this.lastSeq = update.seq;
    if (!preservePhase) this.lastStatusCode = update.statusCode;

    return { state: this.state, events, duplicate: false, outOfOrder: false, gap };
  }

  private detectGap(update: NormalizedScore): FeedGap | null {
    if (this.lastSeq === null || update.seq === this.lastSeq + 1) return null;
    if (this.state.lastFeedTs === null) return null;
    return {
      fromFeedTs: this.state.lastFeedTs,
      toFeedTs: update.feedTs,
      // The gap becomes known at this signed feed message. Keeping that source
      // timestamp makes live ingest and authenticated historical replay fold to
      // the same state instead of leaking the replay machine's wall clock.
      detectedAt: update.feedTs,
    };
  }

  private phaseEvents(update: NormalizedScore): MatchEvent[] {
    if (update.statusCode === null || update.statusCode === this.lastStatusCode) return [];
    const kind = PHASE_EVENT_BY_CODE[update.statusCode];
    if (!kind) return [];
    return [
      {
        id: asMatchEventId(`${update.messageId}:phase:${kind}`),
        fixtureId: update.fixtureId,
        kind,
        feedTs: update.feedTs,
        messageId: update.messageId,
        minute: update.minute,
        side: null,
        score: update.score,
      },
    ];
  }
}
