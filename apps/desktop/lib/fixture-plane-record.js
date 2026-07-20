'use strict'

const b4a = require('b4a')

const FIXTURE_PLANE_VERSION = 1
const MAX_FIXTURE_PLANE_RECORD_BYTES = 64 * 1024
const MAX_EVENTS_PER_SCORE = 32
const MAX_GAPS = 4096
const MAX_CALL_OPTIONS = 16
const MAX_DECIDING_MESSAGES = 32

const FIXTURE_STATUSES = new Set([
  'scheduled',
  'delayed',
  'postponed',
  'first-half',
  'half-time',
  'second-half',
  'end-of-regulation',
  'extra-time',
  'penalty-shootout',
  'full-time',
  'after-extra-time',
  'after-penalties',
  'abandoned',
  'cancelled',
  'unknown'
])

const EVENT_KINDS = new Set([
  'kickoff',
  'goal',
  'own-goal',
  'penalty-scored',
  'penalty-missed',
  'yellow-card',
  'second-yellow',
  'red-card',
  'substitution',
  'corner',
  'shot-on-target',
  'shot-off-target',
  'save',
  'var',
  'offside',
  'foul',
  'half-time',
  'second-half-start',
  'end-of-regulation',
  'extra-time-start',
  'penalty-shootout-start',
  'full-time',
  'abandoned'
])

const CALL_TEMPLATES = new Set(['window', 'threshold', 'next-event', 'market-read', 'crowd'])
const WINDOW_EVENT_KINDS = new Set(['shot-on-target', 'corner', 'goal', 'card'])
const THRESHOLD_METRICS = new Set(['corners', 'goals', 'cards', 'shots-on-target'])
const VOID_REASONS = new Set([
  'feed-gap',
  'abandoned',
  'unresolved-window',
  'late-answer',
  'odds-unavailable',
  'stat-unsupported'
])

const IDENTIFIER = /^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u

class FixturePlaneValidationError extends TypeError {
  constructor (message) {
    super(message)
    this.name = 'FixturePlaneValidationError'
  }
}

function fail (path, reason) {
  throw new FixturePlaneValidationError(`${path} ${reason}`)
}

function object (value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(path, 'must be a plain object')
  }
  return value
}

function keys (value, required, optional, path) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(path, `is missing ${key}`)
  }
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `contains unsupported field ${key}`)
  }
}

function exactKeys (value, expected, path) {
  keys(value, expected, [], path)
  if (Object.keys(value).length !== expected.length) fail(path, `must contain exactly ${expected.join(', ')}`)
}

function text (value, path, max = 256) {
  if (typeof value !== 'string' || !value || value.length > max || value.normalize('NFC') !== value) {
    fail(path, `must be non-empty NFC text of at most ${max} characters`)
  }
  return value
}

function identifier (value, path, max = 256) {
  const result = text(value, path, max)
  if (!IDENTIFIER.test(result)) fail(path, 'contains unsupported identifier characters')
  return result
}

function integer (value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(path, `must be a safe integer of at least ${minimum}`)
  return value
}

function nullableInteger (value, path, minimum = 0) {
  return value === null ? null : integer(value, path, minimum)
}

function status (value, path) {
  if (typeof value !== 'string' || !FIXTURE_STATUSES.has(value)) fail(path, 'is not a supported fixture status')
  return value
}

function score (value, path) {
  const input = object(value, path)
  keys(input, ['home', 'away'], ['penaltiesHome', 'penaltiesAway'], path)
  const result = {
    home: integer(input.home, `${path}.home`),
    away: integer(input.away, `${path}.away`)
  }
  if (input.penaltiesHome !== undefined) result.penaltiesHome = integer(input.penaltiesHome, `${path}.penaltiesHome`)
  if (input.penaltiesAway !== undefined) result.penaltiesAway = integer(input.penaltiesAway, `${path}.penaltiesAway`)
  if ((result.penaltiesHome === undefined) !== (result.penaltiesAway === undefined)) {
    fail(path, 'must contain both penalty scores or neither')
  }
  return result
}

function team (value, path) {
  const input = object(value, path)
  keys(input, ['id', 'name'], ['shortName', 'country'], path)
  const result = {
    id: identifier(input.id, `${path}.id`, 128),
    name: text(input.name, `${path}.name`, 160)
  }
  if (input.shortName !== undefined) result.shortName = text(input.shortName, `${path}.shortName`, 24)
  if (input.country !== undefined) result.country = identifier(input.country, `${path}.country`, 12)
  return result
}

function fixture (value, path) {
  const input = object(value, path)
  keys(
    input,
    ['id', 'competition', 'home', 'away', 'kickoff', 'status'],
    ['rawStatusCode', 'minute', 'score'],
    path
  )
  const result = {
    id: identifier(input.id, `${path}.id`),
    competition: text(input.competition, `${path}.competition`, 200),
    home: team(input.home, `${path}.home`),
    away: team(input.away, `${path}.away`),
    kickoff: integer(input.kickoff, `${path}.kickoff`),
    status: status(input.status, `${path}.status`)
  }
  if (result.home.id === result.away.id) fail(path, 'must contain two different teams')
  if (input.rawStatusCode !== undefined) result.rawStatusCode = integer(input.rawStatusCode, `${path}.rawStatusCode`)
  if (input.minute !== undefined) result.minute = nullableInteger(input.minute, `${path}.minute`)
  if (input.score !== undefined) result.score = score(input.score, `${path}.score`)
  return result
}

function gap (value, path) {
  const input = object(value, path)
  exactKeys(input, ['fromFeedTs', 'toFeedTs', 'detectedAt'], path)
  const result = {
    fromFeedTs: integer(input.fromFeedTs, `${path}.fromFeedTs`),
    toFeedTs: integer(input.toFeedTs, `${path}.toFeedTs`),
    detectedAt: integer(input.detectedAt, `${path}.detectedAt`)
  }
  if (result.toFeedTs < result.fromFeedTs) fail(path, 'must end at or after it starts')
  return result
}

function fixtureState (value, path) {
  const input = object(value, path)
  exactKeys(input, ['fixtureId', 'status', 'minute', 'score', 'lastFeedTs', 'lastMessageId', 'gaps'], path)
  if (!Array.isArray(input.gaps) || input.gaps.length > MAX_GAPS) fail(`${path}.gaps`, `must contain at most ${MAX_GAPS} entries`)
  return {
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`),
    status: status(input.status, `${path}.status`),
    minute: nullableInteger(input.minute, `${path}.minute`),
    score: score(input.score, `${path}.score`),
    lastFeedTs: nullableInteger(input.lastFeedTs, `${path}.lastFeedTs`),
    lastMessageId: input.lastMessageId === null ? null : identifier(input.lastMessageId, `${path}.lastMessageId`),
    gaps: input.gaps.map((entry, index) => gap(entry, `${path}.gaps[${index}]`))
  }
}

function matchEvent (value, path) {
  const input = object(value, path)
  keys(input, ['id', 'fixtureId', 'kind', 'feedTs', 'messageId', 'minute', 'side'], ['score', 'detail'], path)
  if (typeof input.kind !== 'string' || !EVENT_KINDS.has(input.kind)) fail(`${path}.kind`, 'is unsupported')
  if (input.side !== null && input.side !== 'home' && input.side !== 'away') fail(`${path}.side`, 'is invalid')
  const result = {
    id: identifier(input.id, `${path}.id`),
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`),
    kind: input.kind,
    feedTs: integer(input.feedTs, `${path}.feedTs`),
    messageId: input.messageId === null ? null : identifier(input.messageId, `${path}.messageId`),
    minute: nullableInteger(input.minute, `${path}.minute`),
    side: input.side
  }
  if (input.score !== undefined) result.score = score(input.score, `${path}.score`)
  if (input.detail !== undefined) result.detail = text(input.detail, `${path}.detail`, 1024)
  return result
}

function scoreUpdate (value, path) {
  const input = object(value, path)
  exactKeys(input, ['fixtureId', 'feedTs', 'messageId', 'seq', 'statusCode', 'status', 'minute', 'score', 'hasScore'], path)
  if (typeof input.hasScore !== 'boolean') fail(`${path}.hasScore`, 'must be a boolean')
  return {
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`),
    feedTs: integer(input.feedTs, `${path}.feedTs`),
    messageId: identifier(input.messageId, `${path}.messageId`),
    seq: integer(input.seq, `${path}.seq`),
    statusCode: nullableInteger(input.statusCode, `${path}.statusCode`),
    status: status(input.status, `${path}.status`),
    minute: nullableInteger(input.minute, `${path}.minute`),
    score: score(input.score, `${path}.score`),
    hasScore: input.hasScore
  }
}

function odds (value, path) {
  const input = object(value, path)
  exactKeys(input, ['fixtureId', 'feedTs', 'messageId', 'decimal'], path)
  const decimal = object(input.decimal, `${path}.decimal`)
  exactKeys(decimal, ['home', 'draw', 'away'], `${path}.decimal`)
  for (const name of ['home', 'draw', 'away']) {
    if (typeof decimal[name] !== 'number' || !Number.isFinite(decimal[name]) || decimal[name] <= 0) {
      fail(`${path}.decimal.${name}`, 'must be a positive finite number')
    }
  }
  return {
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`),
    feedTs: integer(input.feedTs, `${path}.feedTs`),
    messageId: identifier(input.messageId, `${path}.messageId`),
    decimal: { home: decimal.home, draw: decimal.draw, away: decimal.away }
  }
}

function finiteRange (value, path, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} to ${maximum}`)
  }
  return value
}

function teamSide (value, path) {
  if (value !== 'home' && value !== 'away') fail(path, 'must be home or away')
  return value
}

function callOption (value, path) {
  const input = object(value, path)
  exactKeys(input, ['id', 'label'], path)
  return {
    id: identifier(input.id, `${path}.id`, 64),
    label: text(input.label, `${path}.label`, 128)
  }
}

function callSpec (value, path) {
  const input = object(value, path)
  if (input.kind === 'window') {
    keys(input, ['kind', 'event', 'withinMinutes'], ['side'], path)
    if (typeof input.event !== 'string' || !WINDOW_EVENT_KINDS.has(input.event)) fail(`${path}.event`, 'is unsupported')
    const result = {
      kind: 'window',
      event: input.event,
      withinMinutes: integer(input.withinMinutes, `${path}.withinMinutes`, 1)
    }
    if (input.side !== undefined) result.side = teamSide(input.side, `${path}.side`)
    return result
  }
  if (input.kind === 'threshold') {
    keys(input, ['kind', 'metric', 'atLeast', 'beforeMinute'], ['side'], path)
    if (typeof input.metric !== 'string' || !THRESHOLD_METRICS.has(input.metric)) fail(`${path}.metric`, 'is unsupported')
    const result = {
      kind: 'threshold',
      metric: input.metric,
      atLeast: integer(input.atLeast, `${path}.atLeast`, 1),
      beforeMinute: integer(input.beforeMinute, `${path}.beforeMinute`, 1)
    }
    if (input.side !== undefined) result.side = teamSide(input.side, `${path}.side`)
    return result
  }
  if (input.kind === 'next-event') {
    keys(input, ['kind', 'event'], ['beforeMinute'], path)
    if (input.event !== 'goal') fail(`${path}.event`, 'must be goal')
    const result = { kind: 'next-event', event: 'goal' }
    if (input.beforeMinute !== undefined) result.beforeMinute = integer(input.beforeMinute, `${path}.beforeMinute`, 1)
    return result
  }
  if (input.kind === 'market-read') {
    exactKeys(input, ['kind', 'retraceFraction', 'withinMinutes'], path)
    return {
      kind: 'market-read',
      retraceFraction: finiteRange(input.retraceFraction, `${path}.retraceFraction`, Number.EPSILON, 1),
      withinMinutes: integer(input.withinMinutes, `${path}.withinMinutes`, 1)
    }
  }
  if (input.kind === 'crowd') {
    exactKeys(input, ['kind'], path)
    return { kind: 'crowd' }
  }
  fail(`${path}.kind`, 'is unsupported')
}

function call (value, path) {
  const input = object(value, path)
  keys(input, [
    'id', 'fixtureId', 'roomId', 'template', 'spec', 'prompt', 'options',
    'openedAt', 'locksAt', 'settlesBy', 'scored', 'status'
  ], ['difficulty'], path)
  if (typeof input.template !== 'string' || !CALL_TEMPLATES.has(input.template)) fail(`${path}.template`, 'is unsupported')
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > MAX_CALL_OPTIONS) {
    fail(`${path}.options`, `must contain 2 to ${MAX_CALL_OPTIONS} options`)
  }
  const options = input.options.map((entry, index) => callOption(entry, `${path}.options[${index}]`))
  if (new Set(options.map((option) => option.id)).size !== options.length) fail(`${path}.options`, 'must contain unique option IDs')
  const spec = callSpec(input.spec, `${path}.spec`)
  if (input.template !== spec.kind) fail(`${path}.template`, 'must match spec.kind')
  const openedAt = integer(input.openedAt, `${path}.openedAt`)
  const locksAt = integer(input.locksAt, `${path}.locksAt`)
  const settlesBy = integer(input.settlesBy, `${path}.settlesBy`)
  if (openedAt > locksAt || locksAt > settlesBy) fail(path, 'must have openedAt <= locksAt <= settlesBy')
  if (input.roomId !== null) fail(`${path}.roomId`, 'must be null on the public fixture plane')
  if (input.status !== 'open') fail(`${path}.status`, 'must be open in a call.open record')
  if (typeof input.scored !== 'boolean') fail(`${path}.scored`, 'must be a boolean')
  if (spec.kind === 'crowd') fail(`${path}.spec.kind`, 'cannot depend on room state on the public fixture plane')
  const result = {
    id: identifier(input.id, `${path}.id`),
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`),
    roomId: null,
    template: input.template,
    spec,
    prompt: text(input.prompt, `${path}.prompt`, 512),
    options,
    openedAt,
    locksAt,
    settlesBy,
    scored: input.scored,
    status: 'open'
  }
  if (input.difficulty !== undefined) {
    result.difficulty = input.difficulty === null
      ? null
      : finiteRange(input.difficulty, `${path}.difficulty`, 0, 1)
  }
  return result
}

function settleOutcome (value, path) {
  const input = object(value, path)
  if (input.status === 'settled') {
    exactKeys(input, ['status', 'winningOption'], path)
    return { status: 'settled', winningOption: identifier(input.winningOption, `${path}.winningOption`, 64) }
  }
  if (input.status === 'void') {
    exactKeys(input, ['status', 'reason'], path)
    if (typeof input.reason !== 'string' || !VOID_REASONS.has(input.reason)) fail(`${path}.reason`, 'is unsupported')
    return { status: 'void', reason: input.reason }
  }
  fail(`${path}.status`, 'is unsupported')
}

function settlement (value, path) {
  const input = object(value, path)
  exactKeys(input, ['id', 'callId', 'outcome', 'settledAtFeedTs', 'decidingMessageIds'], path)
  const callId = identifier(input.callId, `${path}.callId`)
  const id = identifier(input.id, `${path}.id`)
  if (id !== `settlement:${callId}`) fail(`${path}.id`, 'must be derived from callId')
  const outcome = settleOutcome(input.outcome, `${path}.outcome`)
  const settledAtFeedTs = input.settledAtFeedTs === null
    ? null
    : integer(input.settledAtFeedTs, `${path}.settledAtFeedTs`)
  if (outcome.status === 'settled' && settledAtFeedTs === null) fail(`${path}.settledAtFeedTs`, 'must identify when a settled outcome was decided')
  if (outcome.status === 'void' && settledAtFeedTs !== null) fail(`${path}.settledAtFeedTs`, 'must be null for a void outcome')
  if (!Array.isArray(input.decidingMessageIds) || input.decidingMessageIds.length > MAX_DECIDING_MESSAGES) {
    fail(`${path}.decidingMessageIds`, `must contain at most ${MAX_DECIDING_MESSAGES} message IDs`)
  }
  const decidingMessageIds = input.decidingMessageIds.map((entry, index) =>
    identifier(entry, `${path}.decidingMessageIds[${index}]`))
  if (new Set(decidingMessageIds).size !== decidingMessageIds.length) {
    fail(`${path}.decidingMessageIds`, 'must contain unique message IDs')
  }
  return { id, callId, outcome, settledAtFeedTs, decidingMessageIds }
}

function parseFixturePlaneRecord (value) {
  const input = object(value, 'fixture-plane record')
  if (input.version !== FIXTURE_PLANE_VERSION) fail('fixture-plane record.version', 'is unsupported')
  const publishedAt = integer(input.publishedAt, 'fixture-plane record.publishedAt')
  if (input.kind === 'fixture.upsert') {
    exactKeys(input, ['version', 'kind', 'publishedAt', 'fixture'], 'fixture-plane record')
    return { version: FIXTURE_PLANE_VERSION, kind: input.kind, publishedAt, fixture: fixture(input.fixture, 'fixture') }
  }
  if (input.kind === 'fixture.score') {
    exactKeys(input, ['version', 'kind', 'publishedAt', 'update', 'state', 'events'], 'fixture-plane record')
    const update = scoreUpdate(input.update, 'update')
    const state = fixtureState(input.state, 'state')
    if (!Array.isArray(input.events) || input.events.length > MAX_EVENTS_PER_SCORE) {
      fail('events', `must contain at most ${MAX_EVENTS_PER_SCORE} entries`)
    }
    const events = input.events.map((entry, index) => matchEvent(entry, `events[${index}]`))
    if (state.fixtureId !== update.fixtureId || state.lastFeedTs !== update.feedTs ||
        state.lastMessageId !== update.messageId || state.status !== update.status) {
      fail('state', 'must describe the supplied update')
    }
    for (const event of events) {
      if (event.fixtureId !== update.fixtureId || event.feedTs !== update.feedTs || event.messageId !== update.messageId) {
        fail('events', 'must describe the supplied update')
      }
    }
    return { version: FIXTURE_PLANE_VERSION, kind: input.kind, publishedAt, update, state, events }
  }
  if (input.kind === 'fixture.odds') {
    exactKeys(input, ['version', 'kind', 'publishedAt', 'odds'], 'fixture-plane record')
    return { version: FIXTURE_PLANE_VERSION, kind: input.kind, publishedAt, odds: odds(input.odds, 'odds') }
  }
  if (input.kind === 'call.open') {
    exactKeys(input, ['version', 'kind', 'publishedAt', 'call'], 'fixture-plane record')
    return { version: FIXTURE_PLANE_VERSION, kind: input.kind, publishedAt, call: call(input.call, 'call') }
  }
  if (input.kind === 'call.settled') {
    exactKeys(input, ['version', 'kind', 'publishedAt', 'fixtureId', 'settlement'], 'fixture-plane record')
    return {
      version: FIXTURE_PLANE_VERSION,
      kind: input.kind,
      publishedAt,
      fixtureId: identifier(input.fixtureId, 'fixtureId'),
      settlement: settlement(input.settlement, 'settlement')
    }
  }
  fail('fixture-plane record.kind', 'is unsupported')
}

function decodeFixturePlaneRecord (block) {
  if (!b4a.isBuffer(block) && !(block instanceof Uint8Array)) fail('fixture-plane block', 'must be bytes')
  if (block.byteLength > MAX_FIXTURE_PLANE_RECORD_BYTES) {
    fail('fixture-plane block', `must not exceed ${MAX_FIXTURE_PLANE_RECORD_BYTES} bytes`)
  }
  const bytes = b4a.from(block)
  const decoded = b4a.toString(bytes, 'utf8')
  if (!b4a.equals(bytes, b4a.from(decoded, 'utf8'))) fail('fixture-plane block', 'must be canonical UTF-8')
  let value
  try {
    value = JSON.parse(decoded)
  } catch {
    fail('fixture-plane block', 'must contain valid JSON')
  }
  return parseFixturePlaneRecord(value)
}

module.exports = {
  FIXTURE_PLANE_VERSION,
  FixturePlaneValidationError,
  MAX_FIXTURE_PLANE_RECORD_BYTES,
  decodeFixturePlaneRecord,
  parseFixturePlaneRecord
}
