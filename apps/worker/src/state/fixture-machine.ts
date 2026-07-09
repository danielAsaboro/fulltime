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
  5: "full-time",
  7: "extra-time-start",
  12: "penalty-shootout-start",
  15: "abandoned",
  16: "abandoned",
  17: "abandoned",
  18: "abandoned",
  19: "abandoned",
};

export interface FixtureStepResult {
  state: FixtureState;
  events: MatchEvent[];
  duplicate: boolean;
  outOfOrder: boolean;
  gap: FeedGap | null;
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

  constructor(fixtureId: FixtureId) {
    this.state = initialState(fixtureId);
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
    const events = [...this.phaseEvents(update), ...update.incidents];

    this.state = {
      ...this.state,
      status: update.status,
      minute: update.minute ?? this.state.minute,
      score: update.hasScore ? update.score : this.state.score,
      lastFeedTs: update.feedTs,
      lastMessageId: update.messageId,
      gaps: gap ? [...this.state.gaps, gap] : this.state.gaps,
    };
    this.lastSeq = update.seq;
    this.lastStatusCode = update.statusCode;

    return { state: this.state, events, duplicate: false, outOfOrder: false, gap };
  }

  private detectGap(update: NormalizedScore): FeedGap | null {
    if (this.lastSeq === null || update.seq === this.lastSeq + 1) return null;
    if (this.state.lastFeedTs === null) return null;
    return {
      fromFeedTs: this.state.lastFeedTs,
      toFeedTs: update.feedTs,
      detectedAt: Date.now(),
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
