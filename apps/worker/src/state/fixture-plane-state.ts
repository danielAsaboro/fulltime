/**
 * Ordered projection of the publisher-signed fixture plane.
 *
 * This is rebuilt exclusively from verified Hypercore blocks on startup. It is
 * also the only state supplied to the settlement engine: canonical events, odds,
 * feed gaps, fixture status and the signed feed-time frontier.
 */

import {
  FIXTURE_PLANE_VERSION,
  callsForEvent,
  evaluateCall,
  parseFixturePlaneRecord,
  type Call,
  type FixtureCallOpenRecord,
  type FixtureCallSettledRecord,
  type FixturePlaneRecord,
  type FixtureScoreRecord,
  type MatchEvent,
  type OddsSnapshot,
  type SettleContext,
  type WallClock,
} from "@fulltime/shared";

interface ExpectedCall {
  call: Call;
  publishedAt: WallClock;
}

interface EventEntry {
  event: MatchEvent;
  publishedAt: WallClock;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function copyRecord<T extends FixturePlaneRecord>(value: T): T {
  return parseFixturePlaneRecord(value) as T;
}

/** Fail before append if a record would make the signed projection contradictory. */
export class SignedFixturePlaneState {
  private readonly latestScores = new Map<string, FixtureScoreRecord>();
  private readonly events = new Map<string, Map<string, EventEntry>>();
  private readonly odds = new Map<string, Map<string, OddsSnapshot>>();
  private readonly expectedCalls = new Map<string, ExpectedCall>();
  private readonly calls = new Map<string, FixtureCallOpenRecord>();
  private readonly openCalls = new Map<string, FixtureCallOpenRecord>();
  private readonly settlements = new Map<string, FixtureCallSettledRecord>();
  private readonly latestPublishedAt = new Map<string, WallClock>();

  clear(): void {
    this.latestScores.clear();
    this.events.clear();
    this.odds.clear();
    this.expectedCalls.clear();
    this.calls.clear();
    this.openCalls.clear();
    this.settlements.clear();
    this.latestPublishedAt.clear();
  }

  assertCanApply(value: FixturePlaneRecord): void {
    if (value.kind === "fixture.score") {
      const fixtureEvents = this.events.get(value.update.fixtureId);
      for (const event of value.events) {
        const existing = fixtureEvents?.get(event.id);
        if (existing && fingerprint(existing.event) !== fingerprint(event)) {
          throw new Error(`Conflicting canonical event ${event.id}`);
        }
        for (const generated of callsForEvent(event)) {
          const expected = this.expectedCalls.get(generated.id);
          if (expected && fingerprint(expected.call) !== fingerprint(generated)) {
            throw new Error(`Conflicting deterministic call ${generated.id}`);
          }
        }
      }
      return;
    }

    if (value.kind === "call.open") {
      const expected = this.expectedCalls.get(value.call.id);
      if (!expected || fingerprint(expected.call) !== fingerprint(value.call)) {
        throw new Error(`Call ${value.call.id} is not emitted by a canonical signed event`);
      }
      if (this.settlements.has(value.call.id)) {
        throw new Error(`Call ${value.call.id} cannot open after settlement`);
      }
      return;
    }

    if (value.kind === "call.settled") {
      const opened = this.openCalls.get(value.settlement.callId);
      if (!opened) throw new Error(`Settlement references unopened call ${value.settlement.callId}`);
      if (opened.call.fixtureId !== value.fixtureId) {
        throw new Error(`Settlement fixture does not match call ${value.settlement.callId}`);
      }
      const context = this.context(value.fixtureId);
      if (!context) throw new Error(`Settlement has no signed fixture state for ${value.fixtureId}`);
      const decision = evaluateCall(opened.call, context);
      if (decision.status !== "decided" || fingerprint(decision.settlement) !== fingerprint(value.settlement)) {
        throw new Error(`Settlement for ${value.settlement.callId} is not the total signed-fixture decision`);
      }
    }
  }

  apply(value: FixturePlaneRecord): void {
    this.assertCanApply(value);

    if (value.kind === "fixture.score") {
      const fixtureId = String(value.update.fixtureId);
      const latest = this.latestScores.get(fixtureId);
      if (!latest || value.update.seq > latest.update.seq) {
        this.latestScores.set(fixtureId, copyRecord(value));
      }
      let fixtureEvents = this.events.get(fixtureId);
      if (!fixtureEvents) {
        fixtureEvents = new Map();
        this.events.set(fixtureId, fixtureEvents);
      }
      for (const event of value.events) {
        if (!fixtureEvents.has(event.id)) {
          fixtureEvents.set(event.id, { event: structuredClone(event), publishedAt: value.publishedAt });
        }
        for (const generated of callsForEvent(event)) {
          if (!this.expectedCalls.has(generated.id)) {
            this.expectedCalls.set(generated.id, {
              call: structuredClone(generated),
              publishedAt: value.publishedAt,
            });
          }
        }
      }
      this.rememberPublishedAt(fixtureId, value.publishedAt);
      return;
    }

    if (value.kind === "fixture.odds") {
      const fixtureId = String(value.odds.fixtureId);
      let fixtureOdds = this.odds.get(fixtureId);
      if (!fixtureOdds) {
        fixtureOdds = new Map();
        this.odds.set(fixtureId, fixtureOdds);
      }
      fixtureOdds.set(String(value.odds.messageId), structuredClone(value.odds));
      this.rememberPublishedAt(fixtureId, value.publishedAt);
      return;
    }

    if (value.kind === "call.open") {
      const copy = copyRecord(value);
      this.calls.set(value.call.id, copy);
      this.openCalls.set(value.call.id, copy);
      return;
    }

    if (value.kind === "call.settled") {
      const copy = copyRecord(value);
      this.settlements.set(value.settlement.callId, copy);
      this.openCalls.delete(value.settlement.callId);
    }
  }

  scoreCheckpoints(): FixtureScoreRecord[] {
    return [...this.latestScores.values()].map((record) => copyRecord(record));
  }

  eventHistory(fixtureId: string): MatchEvent[] {
    return [...(this.events.get(fixtureId)?.values() ?? [])]
      .map((entry) => structuredClone(entry.event))
      .sort((left, right) => left.feedTs - right.feedTs || String(left.id).localeCompare(String(right.id)));
  }

  oddsHistory(fixtureId: string): OddsSnapshot[] {
    return [...(this.odds.get(fixtureId)?.values() ?? [])]
      .map((entry) => structuredClone(entry))
      .sort(
        (left, right) =>
          left.feedTs - right.feedTs || String(left.messageId).localeCompare(String(right.messageId)),
      );
  }

  openCallRecords(): FixtureCallOpenRecord[] {
    return [...this.openCalls.values()]
      .map((record) => copyRecord(record))
      .sort((left, right) => left.call.openedAt - right.call.openedAt || String(left.call.id).localeCompare(String(right.call.id)));
  }

  settlementRecords(): FixtureCallSettledRecord[] {
    return [...this.settlements.values()]
      .map((record) => copyRecord(record))
      .sort((left, right) => String(left.settlement.callId).localeCompare(String(right.settlement.callId)));
  }

  /** Canonical call records absent after a crash between score and derived append. */
  missingCallRecords(): FixtureCallOpenRecord[] {
    const records: FixtureCallOpenRecord[] = [];
    for (const [callId, expected] of this.expectedCalls) {
      if (this.calls.has(callId)) continue;
      records.push({
        version: FIXTURE_PLANE_VERSION,
        kind: "call.open",
        publishedAt: expected.publishedAt,
        call: structuredClone(expected.call),
      });
    }
    return records.sort(
      (left, right) => left.call.openedAt - right.call.openedAt || String(left.call.id).localeCompare(String(right.call.id)),
    );
  }

  /** Every decision available at the current signed frontier, excluding prior settlements. */
  pendingSettlementRecords(fixtureId?: string): FixtureCallSettledRecord[] {
    const records: FixtureCallSettledRecord[] = [];
    for (const opened of this.openCalls.values()) {
      if (fixtureId !== undefined && opened.call.fixtureId !== fixtureId) continue;
      const id = String(opened.call.fixtureId);
      const context = this.context(id);
      const publishedAt = this.latestPublishedAt.get(id);
      if (!context || publishedAt === undefined) continue;
      const decision = evaluateCall(opened.call, context);
      if (decision.status !== "decided") continue;
      records.push({
        version: FIXTURE_PLANE_VERSION,
        kind: "call.settled",
        publishedAt,
        fixtureId: opened.call.fixtureId,
        settlement: decision.settlement,
      });
    }
    return records.sort((left, right) =>
      String(left.settlement.callId).localeCompare(String(right.settlement.callId)),
    );
  }

  context(fixtureId: string): SettleContext | null {
    const latest = this.latestScores.get(fixtureId);
    if (!latest) return null;
    const events = this.eventHistory(fixtureId);
    const odds = this.oddsHistory(fixtureId);
    const frontierFeedTs = Math.max(
      latest.update.feedTs,
      ...odds.map((entry) => Number(entry.feedTs)),
    ) as SettleContext["frontierFeedTs"];
    return {
      events,
      odds,
      gaps: structuredClone(latest.state.gaps),
      fixtureStatus: latest.state.status,
      frontierFeedTs,
      fixtureMinute: latest.state.minute,
    };
  }

  private rememberPublishedAt(fixtureId: string, publishedAt: WallClock): void {
    const current = this.latestPublishedAt.get(fixtureId);
    if (current === undefined || publishedAt > current) this.latestPublishedAt.set(fixtureId, publishedAt);
  }
}
