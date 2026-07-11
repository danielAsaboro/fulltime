/**
 * Publisher-signed fixture plane.
 *
 * These records are the only match facts a FullTime client may trust. They are
 * appended to a single-writer public Hypercore; Hypercore verifies every block
 * against the pinned writer key before this decoder sees it. The room Autobase
 * may reference these records, but room writers cannot create or alter them.
 *
 * Keep this schema small, versioned, and runtime validated. A TypeScript cast is
 * not a trust boundary when bytes came from another peer.
 */

import type {
  CallId,
  FeedMessageId,
  FixtureId,
  RoomId,
  SettlementId,
} from "./ids";
import type {
  Call,
  CallOption,
  CallSpec,
  CallTemplateKind,
  ThresholdMetric,
  WindowEventKind,
} from "./calls";
import type { FeedGap, FixtureState, MatchEvent, MatchEventKind, TeamSide } from "./events";
import type { Fixture, FixtureScore, FixtureStatus, Team } from "./fixtures";
import type { OddsSnapshot, OutcomeKey } from "./odds";
import type { Settlement, SettleOutcome, VoidReason } from "./settlements";
import type { FeedTimestamp, WallClock } from "./time";

export const FIXTURE_PLANE_VERSION = 1 as const;
export const MAX_FIXTURE_PLANE_RECORD_BYTES = 64 * 1024;
export const MAX_FIXTURE_PLANE_EVENTS_PER_SCORE = 32;
export const MAX_FIXTURE_PLANE_GAPS = 4_096;
export const MAX_FIXTURE_PLANE_CALL_OPTIONS = 16;
export const MAX_FIXTURE_PLANE_DECIDING_MESSAGES = 32;

export interface PublishedScoreUpdate {
  fixtureId: FixtureId;
  feedTs: FeedTimestamp;
  messageId: FeedMessageId;
  seq: number;
  statusCode: number | null;
  status: FixtureStatus;
  minute: number | null;
  score: FixtureScore;
  /** False for status/minute-only updates whose zero score must not replace state. */
  hasScore: boolean;
}

interface FixturePlaneRecordBase {
  version: typeof FIXTURE_PLANE_VERSION;
  /** Publisher wall clock. Ordering and settlement continue to use feed time. */
  publishedAt: WallClock;
}

export interface FixtureUpsertRecord extends FixturePlaneRecordBase {
  kind: "fixture.upsert";
  fixture: Fixture;
}

export interface FixtureScoreRecord extends FixturePlaneRecordBase {
  kind: "fixture.score";
  update: PublishedScoreUpdate;
  /** Canonical fold immediately after this update. */
  state: FixtureState;
  /** Incidents plus any phase transition emitted by this update. */
  events: MatchEvent[];
}

export interface FixtureOddsRecord extends FixturePlaneRecordBase {
  kind: "fixture.odds";
  odds: OddsSnapshot;
}

/** A deterministic match-wide call emitted from one canonical signed event. */
export interface FixtureCallOpenRecord extends FixturePlaneRecordBase {
  kind: "call.open";
  call: Call;
}

/** A total decision over signed fixture facts. Room answers never enter this record. */
export interface FixtureCallSettledRecord extends FixturePlaneRecordBase {
  kind: "call.settled";
  fixtureId: FixtureId;
  settlement: Settlement;
}

export type FixturePlaneRecord =
  | FixtureUpsertRecord
  | FixtureScoreRecord
  | FixtureOddsRecord
  | FixtureCallOpenRecord
  | FixtureCallSettledRecord;

export class FixturePlaneValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "FixturePlaneValidationError";
  }
}

const FIXTURE_STATUSES: ReadonlySet<string> = new Set<FixtureStatus>([
  "scheduled",
  "delayed",
  "postponed",
  "first-half",
  "half-time",
  "second-half",
  "extra-time",
  "penalty-shootout",
  "full-time",
  "after-extra-time",
  "after-penalties",
  "abandoned",
  "cancelled",
  "unknown",
]);

const EVENT_KINDS: ReadonlySet<string> = new Set<MatchEventKind>([
  "kickoff",
  "goal",
  "own-goal",
  "penalty-scored",
  "penalty-missed",
  "yellow-card",
  "second-yellow",
  "red-card",
  "substitution",
  "corner",
  "shot-on-target",
  "shot-off-target",
  "save",
  "var",
  "offside",
  "foul",
  "half-time",
  "second-half-start",
  "extra-time-start",
  "penalty-shootout-start",
  "full-time",
  "abandoned",
]);

const CALL_TEMPLATES: ReadonlySet<string> = new Set<CallTemplateKind>([
  "window",
  "threshold",
  "next-event",
  "market-read",
  "crowd",
]);
const WINDOW_EVENT_KINDS: ReadonlySet<string> = new Set<WindowEventKind>([
  "shot-on-target",
  "corner",
  "goal",
  "card",
]);
const THRESHOLD_METRICS: ReadonlySet<string> = new Set<ThresholdMetric>([
  "corners",
  "goals",
  "cards",
  "shots-on-target",
]);
const VOID_REASONS: ReadonlySet<string> = new Set<VoidReason>([
  "feed-gap",
  "abandoned",
  "unresolved-window",
  "late-answer",
  "odds-unavailable",
  "stat-unsupported",
]);

const encoder = new TextEncoder();
const IDENTIFIER = /^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u;

function fail(path: string, reason: string): never {
  throw new FixturePlaneValidationError(`${path} ${reason}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, "must be a plain object");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    fail(path, `must contain exactly: ${allowed.join(", ")}`);
  }
}

function optionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(path, `is missing ${key}`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `contains unsupported field ${key}`);
  }
}

function string(value: unknown, path: string, max = 256): string {
  if (typeof value !== "string") fail(path, "must be a string");
  const normalized = value.normalize("NFC");
  if (!normalized || normalized !== value || value.length > max) {
    fail(path, `must be non-empty NFC text of at most ${max} characters`);
  }
  return value;
}

function identifier(value: unknown, path: string, max = 256): string {
  const result = string(value, path, max);
  if (!IDENTIFIER.test(result)) fail(path, "contains unsupported identifier characters");
  return result;
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(path, "must be a safe integer");
  return Number(value);
}

function nullableInteger(value: unknown, path: string, minimum = 0): number | null {
  return value === null ? null : safeInteger(value, path, minimum);
}

function finitePositive(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(path, "must be a positive finite number");
  }
  return value;
}

function finiteRange(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

function teamSide(value: unknown, path: string): TeamSide {
  if (value !== "home" && value !== "away") fail(path, "must be home or away");
  return value;
}

function fixtureScore(value: unknown, path: string): FixtureScore {
  const input = record(value, path);
  optionalKeys(input, ["home", "away"], ["penaltiesHome", "penaltiesAway"], path);
  const score: FixtureScore = {
    home: safeInteger(input.home, `${path}.home`),
    away: safeInteger(input.away, `${path}.away`),
  };
  if (input.penaltiesHome !== undefined) {
    score.penaltiesHome = safeInteger(input.penaltiesHome, `${path}.penaltiesHome`);
  }
  if (input.penaltiesAway !== undefined) {
    score.penaltiesAway = safeInteger(input.penaltiesAway, `${path}.penaltiesAway`);
  }
  if ((score.penaltiesHome === undefined) !== (score.penaltiesAway === undefined)) {
    fail(path, "must include both penalty scores or neither");
  }
  return score;
}

function team(value: unknown, path: string): Team {
  const input = record(value, path);
  optionalKeys(input, ["id", "name"], ["shortName", "country"], path);
  const result: Team = {
    id: identifier(input.id, `${path}.id`, 128),
    name: string(input.name, `${path}.name`, 160),
  };
  if (input.shortName !== undefined) result.shortName = string(input.shortName, `${path}.shortName`, 24);
  if (input.country !== undefined) result.country = identifier(input.country, `${path}.country`, 12);
  return result;
}

function fixtureStatus(value: unknown, path: string): FixtureStatus {
  if (typeof value !== "string" || !FIXTURE_STATUSES.has(value)) fail(path, "is not a supported fixture status");
  return value as FixtureStatus;
}

function fixture(value: unknown, path: string): Fixture {
  const input = record(value, path);
  optionalKeys(
    input,
    ["id", "competition", "home", "away", "kickoff", "status"],
    ["rawStatusCode", "minute", "score"],
    path,
  );
  const result: Fixture = {
    id: identifier(input.id, `${path}.id`) as FixtureId,
    competition: string(input.competition, `${path}.competition`, 200),
    home: team(input.home, `${path}.home`),
    away: team(input.away, `${path}.away`),
    kickoff: safeInteger(input.kickoff, `${path}.kickoff`) as FeedTimestamp,
    status: fixtureStatus(input.status, `${path}.status`),
  };
  if (result.home.id === result.away.id) fail(path, "must contain two different teams");
  if (input.rawStatusCode !== undefined) {
    result.rawStatusCode = safeInteger(input.rawStatusCode, `${path}.rawStatusCode`);
  }
  if (input.minute !== undefined) result.minute = nullableInteger(input.minute, `${path}.minute`);
  if (input.score !== undefined) result.score = fixtureScore(input.score, `${path}.score`);
  return result;
}

function gap(value: unknown, path: string): FeedGap {
  const input = record(value, path);
  exactKeys(input, ["fromFeedTs", "toFeedTs", "detectedAt"], path);
  const fromFeedTs = safeInteger(input.fromFeedTs, `${path}.fromFeedTs`) as FeedTimestamp;
  const toFeedTs = safeInteger(input.toFeedTs, `${path}.toFeedTs`) as FeedTimestamp;
  if (toFeedTs < fromFeedTs) fail(path, "must end at or after it starts");
  return {
    fromFeedTs,
    toFeedTs,
    detectedAt: safeInteger(input.detectedAt, `${path}.detectedAt`) as WallClock,
  };
}

function state(value: unknown, path: string): FixtureState {
  const input = record(value, path);
  exactKeys(input, ["fixtureId", "status", "minute", "score", "lastFeedTs", "lastMessageId", "gaps"], path);
  if (!Array.isArray(input.gaps) || input.gaps.length > MAX_FIXTURE_PLANE_GAPS) {
    fail(`${path}.gaps`, `must contain at most ${MAX_FIXTURE_PLANE_GAPS} gaps`);
  }
  return {
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`) as FixtureId,
    status: fixtureStatus(input.status, `${path}.status`),
    minute: nullableInteger(input.minute, `${path}.minute`),
    score: fixtureScore(input.score, `${path}.score`),
    lastFeedTs: input.lastFeedTs === null
      ? null
      : safeInteger(input.lastFeedTs, `${path}.lastFeedTs`) as FeedTimestamp,
    lastMessageId: input.lastMessageId === null
      ? null
      : identifier(input.lastMessageId, `${path}.lastMessageId`) as FeedMessageId,
    gaps: input.gaps.map((entry, index) => gap(entry, `${path}.gaps[${index}]`)),
  };
}

function event(value: unknown, path: string): MatchEvent {
  const input = record(value, path);
  optionalKeys(
    input,
    ["id", "fixtureId", "kind", "feedTs", "messageId", "minute", "side"],
    ["score", "detail"],
    path,
  );
  if (typeof input.kind !== "string" || !EVENT_KINDS.has(input.kind)) fail(`${path}.kind`, "is unsupported");
  if (input.side !== null && input.side !== "home" && input.side !== "away") fail(`${path}.side`, "is invalid");
  const result: MatchEvent = {
    id: identifier(input.id, `${path}.id`) as MatchEvent["id"],
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`) as FixtureId,
    kind: input.kind as MatchEventKind,
    feedTs: safeInteger(input.feedTs, `${path}.feedTs`) as FeedTimestamp,
    messageId: input.messageId === null
      ? null
      : identifier(input.messageId, `${path}.messageId`) as FeedMessageId,
    minute: nullableInteger(input.minute, `${path}.minute`),
    side: input.side as TeamSide | null,
  };
  if (input.score !== undefined) result.score = fixtureScore(input.score, `${path}.score`);
  if (input.detail !== undefined) result.detail = string(input.detail, `${path}.detail`, 1_024);
  return result;
}

function scoreUpdate(value: unknown, path: string): PublishedScoreUpdate {
  const input = record(value, path);
  exactKeys(
    input,
    ["fixtureId", "feedTs", "messageId", "seq", "statusCode", "status", "minute", "score", "hasScore"],
    path,
  );
  if (typeof input.hasScore !== "boolean") fail(`${path}.hasScore`, "must be a boolean");
  return {
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`) as FixtureId,
    feedTs: safeInteger(input.feedTs, `${path}.feedTs`) as FeedTimestamp,
    messageId: identifier(input.messageId, `${path}.messageId`) as FeedMessageId,
    seq: safeInteger(input.seq, `${path}.seq`),
    statusCode: nullableInteger(input.statusCode, `${path}.statusCode`),
    status: fixtureStatus(input.status, `${path}.status`),
    minute: nullableInteger(input.minute, `${path}.minute`),
    score: fixtureScore(input.score, `${path}.score`),
    hasScore: input.hasScore,
  };
}

function odds(value: unknown, path: string): OddsSnapshot {
  const input = record(value, path);
  exactKeys(input, ["fixtureId", "feedTs", "messageId", "decimal"], path);
  const decimalInput = record(input.decimal, `${path}.decimal`);
  exactKeys(decimalInput, ["home", "draw", "away" satisfies OutcomeKey], `${path}.decimal`);
  return {
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`) as FixtureId,
    feedTs: safeInteger(input.feedTs, `${path}.feedTs`) as FeedTimestamp,
    messageId: identifier(input.messageId, `${path}.messageId`) as FeedMessageId,
    decimal: {
      home: finitePositive(decimalInput.home, `${path}.decimal.home`),
      draw: finitePositive(decimalInput.draw, `${path}.decimal.draw`),
      away: finitePositive(decimalInput.away, `${path}.decimal.away`),
    },
  };
}

function callOption(value: unknown, path: string): CallOption {
  const input = record(value, path);
  exactKeys(input, ["id", "label"], path);
  return {
    id: identifier(input.id, `${path}.id`, 64),
    label: string(input.label, `${path}.label`, 128),
  };
}

function callSpec(value: unknown, path: string): CallSpec {
  const input = record(value, path);
  if (input.kind === "window") {
    optionalKeys(input, ["kind", "event", "withinMinutes"], ["side"], path);
    if (typeof input.event !== "string" || !WINDOW_EVENT_KINDS.has(input.event)) {
      fail(`${path}.event`, "is unsupported");
    }
    const result: CallSpec = {
      kind: "window",
      event: input.event as WindowEventKind,
      withinMinutes: safeInteger(input.withinMinutes, `${path}.withinMinutes`, 1),
    };
    if (input.side !== undefined) result.side = teamSide(input.side, `${path}.side`);
    return result;
  }
  if (input.kind === "threshold") {
    optionalKeys(input, ["kind", "metric", "atLeast", "beforeMinute"], ["side"], path);
    if (typeof input.metric !== "string" || !THRESHOLD_METRICS.has(input.metric)) {
      fail(`${path}.metric`, "is unsupported");
    }
    const result: CallSpec = {
      kind: "threshold",
      metric: input.metric as ThresholdMetric,
      atLeast: safeInteger(input.atLeast, `${path}.atLeast`, 1),
      beforeMinute: safeInteger(input.beforeMinute, `${path}.beforeMinute`, 1),
    };
    if (input.side !== undefined) result.side = teamSide(input.side, `${path}.side`);
    return result;
  }
  if (input.kind === "next-event") {
    optionalKeys(input, ["kind", "event"], ["beforeMinute"], path);
    if (input.event !== "goal") fail(`${path}.event`, "must be goal");
    const result: CallSpec = { kind: "next-event", event: "goal" };
    if (input.beforeMinute !== undefined) {
      result.beforeMinute = safeInteger(input.beforeMinute, `${path}.beforeMinute`, 1);
    }
    return result;
  }
  if (input.kind === "market-read") {
    exactKeys(input, ["kind", "retraceFraction", "withinMinutes"], path);
    return {
      kind: "market-read",
      retraceFraction: finiteRange(input.retraceFraction, `${path}.retraceFraction`, Number.EPSILON, 1),
      withinMinutes: safeInteger(input.withinMinutes, `${path}.withinMinutes`, 1),
    };
  }
  if (input.kind === "crowd") {
    exactKeys(input, ["kind"], path);
    return { kind: "crowd" };
  }
  fail(`${path}.kind`, "is unsupported");
}

function call(value: unknown, path: string): Call {
  const input = record(value, path);
  optionalKeys(
    input,
    [
      "id",
      "fixtureId",
      "roomId",
      "template",
      "spec",
      "prompt",
      "options",
      "openedAt",
      "locksAt",
      "settlesBy",
      "scored",
      "status",
    ],
    ["difficulty"],
    path,
  );
  if (typeof input.template !== "string" || !CALL_TEMPLATES.has(input.template)) {
    fail(`${path}.template`, "is unsupported");
  }
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > MAX_FIXTURE_PLANE_CALL_OPTIONS) {
    fail(`${path}.options`, `must contain 2 to ${MAX_FIXTURE_PLANE_CALL_OPTIONS} options`);
  }
  const options = input.options.map((entry, index) => callOption(entry, `${path}.options[${index}]`));
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    fail(`${path}.options`, "must contain unique option IDs");
  }
  const spec = callSpec(input.spec, `${path}.spec`);
  if (input.template !== spec.kind) fail(`${path}.template`, "must match spec.kind");
  const openedAt = safeInteger(input.openedAt, `${path}.openedAt`) as FeedTimestamp;
  const locksAt = safeInteger(input.locksAt, `${path}.locksAt`) as FeedTimestamp;
  const settlesBy = safeInteger(input.settlesBy, `${path}.settlesBy`) as FeedTimestamp;
  if (openedAt > locksAt || locksAt > settlesBy) fail(path, "must have openedAt <= locksAt <= settlesBy");
  if (input.roomId !== null) fail(`${path}.roomId`, "must be null on the public fixture plane");
  if (input.status !== "open") fail(`${path}.status`, "must be open in a call.open record");
  if (typeof input.scored !== "boolean") fail(`${path}.scored`, "must be a boolean");
  if (spec.kind === "crowd") fail(`${path}.spec.kind`, "cannot depend on room state on the public fixture plane");
  const result: Call = {
    id: identifier(input.id, `${path}.id`) as CallId,
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`) as FixtureId,
    roomId: null as RoomId | null,
    template: input.template as CallTemplateKind,
    spec,
    prompt: string(input.prompt, `${path}.prompt`, 512),
    options,
    openedAt,
    locksAt,
    settlesBy,
    scored: input.scored,
    status: "open",
  };
  if (input.difficulty !== undefined) {
    result.difficulty = input.difficulty === null
      ? null
      : finiteRange(input.difficulty, `${path}.difficulty`, 0, 1);
  }
  return result;
}

function settleOutcome(value: unknown, path: string): SettleOutcome {
  const input = record(value, path);
  if (input.status === "settled") {
    exactKeys(input, ["status", "winningOption"], path);
    return { status: "settled", winningOption: identifier(input.winningOption, `${path}.winningOption`, 64) };
  }
  if (input.status === "void") {
    exactKeys(input, ["status", "reason"], path);
    if (typeof input.reason !== "string" || !VOID_REASONS.has(input.reason)) {
      fail(`${path}.reason`, "is unsupported");
    }
    return { status: "void", reason: input.reason as VoidReason };
  }
  fail(`${path}.status`, "is unsupported");
}

function settlement(value: unknown, path: string): Settlement {
  const input = record(value, path);
  exactKeys(input, ["id", "callId", "outcome", "settledAtFeedTs", "decidingMessageIds"], path);
  const callId = identifier(input.callId, `${path}.callId`) as CallId;
  const id = identifier(input.id, `${path}.id`) as SettlementId;
  if (id !== `settlement:${callId}`) fail(`${path}.id`, "must be derived from callId");
  const outcome = settleOutcome(input.outcome, `${path}.outcome`);
  const settledAtFeedTs = input.settledAtFeedTs === null
    ? null
    : safeInteger(input.settledAtFeedTs, `${path}.settledAtFeedTs`) as FeedTimestamp;
  if (outcome.status === "settled" && settledAtFeedTs === null) {
    fail(`${path}.settledAtFeedTs`, "must identify when a settled outcome was decided");
  }
  if (outcome.status === "void" && settledAtFeedTs !== null) {
    fail(`${path}.settledAtFeedTs`, "must be null for a void outcome");
  }
  if (!Array.isArray(input.decidingMessageIds) || input.decidingMessageIds.length > MAX_FIXTURE_PLANE_DECIDING_MESSAGES) {
    fail(
      `${path}.decidingMessageIds`,
      `must contain at most ${MAX_FIXTURE_PLANE_DECIDING_MESSAGES} message IDs`,
    );
  }
  const decidingMessageIds = input.decidingMessageIds.map(
    (entry, index) => identifier(entry, `${path}.decidingMessageIds[${index}]`) as FeedMessageId,
  );
  if (new Set(decidingMessageIds).size !== decidingMessageIds.length) {
    fail(`${path}.decidingMessageIds`, "must contain unique message IDs");
  }
  return { id, callId, outcome, settledAtFeedTs, decidingMessageIds };
}

function parseKnownRecord(value: unknown): FixturePlaneRecord {
  const input = record(value, "fixture-plane record");
  if (input.version !== FIXTURE_PLANE_VERSION) fail("fixture-plane record.version", "is unsupported");
  const publishedAt = safeInteger(input.publishedAt, "fixture-plane record.publishedAt") as WallClock;

  if (input.kind === "fixture.upsert") {
    exactKeys(input, ["version", "kind", "publishedAt", "fixture"], "fixture-plane record");
    return { version: FIXTURE_PLANE_VERSION, kind: "fixture.upsert", publishedAt, fixture: fixture(input.fixture, "fixture") };
  }

  if (input.kind === "fixture.score") {
    exactKeys(input, ["version", "kind", "publishedAt", "update", "state", "events"], "fixture-plane record");
    const update = scoreUpdate(input.update, "update");
    const nextState = state(input.state, "state");
    if (!Array.isArray(input.events) || input.events.length > MAX_FIXTURE_PLANE_EVENTS_PER_SCORE) {
      fail("events", `must contain at most ${MAX_FIXTURE_PLANE_EVENTS_PER_SCORE} events`);
    }
    const events = input.events.map((entry, index) => event(entry, `events[${index}]`));
    if (nextState.fixtureId !== update.fixtureId) fail("state.fixtureId", "must match update.fixtureId");
    if (nextState.lastFeedTs !== update.feedTs) fail("state.lastFeedTs", "must match update.feedTs");
    if (nextState.lastMessageId !== update.messageId) fail("state.lastMessageId", "must match update.messageId");
    if (nextState.status !== update.status) fail("state.status", "must match update.status");
    for (const item of events) {
      if (item.fixtureId !== update.fixtureId) fail("events.fixtureId", "must match update.fixtureId");
      if (item.feedTs !== update.feedTs) fail("events.feedTs", "must match update.feedTs");
      if (item.messageId !== update.messageId) fail("events.messageId", "must match update.messageId");
    }
    return { version: FIXTURE_PLANE_VERSION, kind: "fixture.score", publishedAt, update, state: nextState, events };
  }

  if (input.kind === "fixture.odds") {
    exactKeys(input, ["version", "kind", "publishedAt", "odds"], "fixture-plane record");
    return { version: FIXTURE_PLANE_VERSION, kind: "fixture.odds", publishedAt, odds: odds(input.odds, "odds") };
  }


  if (input.kind === "call.open") {
    exactKeys(input, ["version", "kind", "publishedAt", "call"], "fixture-plane record");
    return { version: FIXTURE_PLANE_VERSION, kind: "call.open", publishedAt, call: call(input.call, "call") };
  }

  if (input.kind === "call.settled") {
    exactKeys(
      input,
      ["version", "kind", "publishedAt", "fixtureId", "settlement"],
      "fixture-plane record",
    );
    return {
      version: FIXTURE_PLANE_VERSION,
      kind: "call.settled",
      publishedAt,
      fixtureId: identifier(input.fixtureId, "fixtureId") as FixtureId,
      settlement: settlement(input.settlement, "settlement"),
    };
  }

  fail("fixture-plane record.kind", "is unsupported");
}

/** Parse untrusted decoded JSON into a fresh, normalized record. */
export function parseFixturePlaneRecord(value: unknown): FixturePlaneRecord {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail("fixture-plane record", "must be JSON serializable");
  }
  if (encoded === undefined || encoder.encode(encoded).byteLength > MAX_FIXTURE_PLANE_RECORD_BYTES) {
    fail("fixture-plane record", `must not exceed ${MAX_FIXTURE_PLANE_RECORD_BYTES} bytes`);
  }
  return parseKnownRecord(value);
}

export function isFixturePlaneRecord(value: unknown): value is FixturePlaneRecord {
  try {
    parseFixturePlaneRecord(value);
    return true;
  } catch {
    return false;
  }
}

/** Decode and validate one UTF-8 Hypercore block. */
export function decodeFixturePlaneRecord(bytes: Uint8Array): FixturePlaneRecord {
  if (bytes.byteLength > MAX_FIXTURE_PLANE_RECORD_BYTES) {
    fail("fixture-plane block", `must not exceed ${MAX_FIXTURE_PLANE_RECORD_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail("fixture-plane block", "must contain valid UTF-8 JSON");
  }
  return parseFixturePlaneRecord(value);
}

/** Validate and encode a record before appending it to the signed Hypercore. */
export function encodeFixturePlaneRecord(value: FixturePlaneRecord): Uint8Array {
  const parsed = parseFixturePlaneRecord(value);
  const bytes = encoder.encode(JSON.stringify(parsed));
  if (bytes.byteLength > MAX_FIXTURE_PLANE_RECORD_BYTES) {
    fail("fixture-plane block", `must not exceed ${MAX_FIXTURE_PLANE_RECORD_BYTES} bytes`);
  }
  return bytes;
}
