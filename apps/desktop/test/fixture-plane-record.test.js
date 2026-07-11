'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  FixturePlaneValidationError,
  decodeFixturePlaneRecord,
  parseFixturePlaneRecord
} = require('../lib/fixture-plane-record.js')
const { FixtureProjection } = require('../workers/fixture-plane.js')

const FIXTURE = Object.freeze({
  id: 'fixture-42',
  competition: 'World Cup',
  home: { id: 'team-1', name: 'Nigeria', country: 'NG' },
  away: { id: 'team-2', name: 'Japan', country: 'JP' },
  kickoff: 1_800_000_000_000,
  status: 'scheduled'
})

function upsert () {
  return { version: 1, kind: 'fixture.upsert', publishedAt: 1_700_000_000_000, fixture: FIXTURE }
}

function scoreRecord (seq = 1, home = 1) {
  const update = {
    fixtureId: FIXTURE.id,
    feedTs: 1_800_000_001_000 + seq,
    messageId: `${FIXTURE.id}:${seq}`,
    seq,
    statusCode: 2,
    status: 'first-half',
    minute: 12,
    score: { home, away: 0 },
    hasScore: true
  }
  return {
    version: 1,
    kind: 'fixture.score',
    publishedAt: 1_700_000_000_100 + seq,
    update,
    state: {
      fixtureId: FIXTURE.id,
      status: update.status,
      minute: update.minute,
      score: update.score,
      lastFeedTs: update.feedTs,
      lastMessageId: update.messageId,
      gaps: []
    },
    events: []
  }
}

function callOpen () {
  return {
    version: 1,
    kind: 'call.open',
    publishedAt: 1_700_000_000_200,
    call: {
      id: 'call:fixture-42:kickoff:opening-goal',
      fixtureId: FIXTURE.id,
      roomId: null,
      template: 'window',
      spec: { kind: 'window', event: 'goal', withinMinutes: 5 },
      prompt: 'A goal in the next five minutes?',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
      openedAt: 1_800_000_001_000,
      locksAt: 1_800_000_061_000,
      settlesBy: 1_800_000_301_000,
      scored: true,
      status: 'open'
    }
  }
}

function callSettled () {
  const callId = callOpen().call.id
  return {
    version: 1,
    kind: 'call.settled',
    publishedAt: 1_700_000_000_300,
    fixtureId: FIXTURE.id,
    settlement: {
      id: `settlement:${callId}`,
      callId,
      outcome: { status: 'settled', winningOption: 'yes' },
      settledAtFeedTs: 1_800_000_121_000,
      decidingMessageIds: ['fixture-42:goal:1']
    }
  }
}

test('fixture-plane decoder validates a canonical publisher record', () => {
  const bytes = Buffer.from(JSON.stringify(upsert()))
  assert.deepEqual(decodeFixturePlaneRecord(bytes), upsert())
})

test('fixture-plane decoder rejects unknown fields and inconsistent score state', () => {
  assert.throws(
    () => parseFixturePlaneRecord({ ...upsert(), untrusted: true }),
    FixturePlaneValidationError
  )
  const inconsistent = scoreRecord()
  inconsistent.state.lastMessageId = 'fixture-42:other'
  assert.throws(() => parseFixturePlaneRecord(inconsistent), /must describe the supplied update/)
})

test('fixture projection exposes only real records and ignores stale score updates', () => {
  const projection = new FixtureProjection()
  assert.equal(projection.apply(scoreRecord(1, 1)), null)
  assert.equal(projection.list().length, 0)
  const first = projection.apply(parseFixturePlaneRecord(upsert()))
  assert.equal(first.phase, 'live')
  assert.deepEqual(first.score, { home: 1, away: 0 })
  assert.equal(projection.hasVerifiedSnapshot(FIXTURE), true)
  assert.equal(projection.hasVerifiedSnapshot(first.fixture), true)
  const firstLiveSnapshot = structuredClone(first.fixture)

  assert.equal(projection.apply(parseFixturePlaneRecord(scoreRecord(1, 9))), null)
  assert.deepEqual(projection.get(FIXTURE.id).score, { home: 1, away: 0 })
  projection.apply(parseFixturePlaneRecord(scoreRecord(2, 2)))
  assert.deepEqual(projection.get(FIXTURE.id).score, { home: 2, away: 0 })
  assert.equal(projection.hasVerifiedSnapshot(firstLiveSnapshot), true)
  assert.equal(projection.hasVerifiedSnapshot(projection.get(FIXTURE.id).fixture), true)
  assert.equal(projection.hasVerifiedSnapshot({ ...FIXTURE, competition: 'Forged Cup' }), false)
  assert.equal(projection.list({ phase: 'upcoming' }).length, 0)
  assert.equal(projection.list({ phase: 'live' }).length, 1)
})

test('desktop fixture plane validates and projects signed calls and total settlements', () => {
  assert.deepEqual(parseFixturePlaneRecord(callOpen()), callOpen())
  assert.deepEqual(parseFixturePlaneRecord(callSettled()), callSettled())
  const bad = structuredClone(callSettled())
  bad.settlement.outcome.winningOption = 'fabricated'

  const projection = new FixtureProjection()
  projection.apply(parseFixturePlaneRecord(upsert()), { index: 0 })
  projection.apply(parseFixturePlaneRecord(callOpen()), { index: 1 })
  projection.apply(parseFixturePlaneRecord(callSettled()), { index: 2 })
  const projected = projection.getCall(callOpen().call.id)
  assert.equal(projected.callFeedIndex, 1)
  assert.equal(projected.settlementFeedIndex, 2)
  assert.equal(projected.settlement.outcome.winningOption, 'yes')
  assert.throws(() => {
    const other = new FixtureProjection()
    other.apply(parseFixturePlaneRecord(upsert()), { index: 0 })
    other.apply(parseFixturePlaneRecord(callOpen()), { index: 1 })
    other.apply(parseFixturePlaneRecord(bad), { index: 2 })
  }, /outside call/)
})
