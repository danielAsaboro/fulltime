'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const createTestnet = require('hyperdht/testnet')
const crypto = require('hypercore-crypto')
const { tsImport } = require('tsx/esm/api')

const { createHistoricalClock, seedHistoricalRoom } = require('../lib/historical-room-seeder.js')
const { RoomManager } = require('../workers/room-manager.js')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1' &&
  Boolean(process.env.FULLTIME_HISTORICAL_SEED) &&
  Boolean(process.env.FULLTIME_HISTORICAL_CAPTURE)

test('one historical room traverses the real signed fixture, pairing, Autobase, and attestor boundaries', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1, FULLTIME_HISTORICAL_SEED, and FULLTIME_HISTORICAL_CAPTURE',
  timeout: 360_000
}, async () => {
  const seedPath = path.resolve(process.env.FULLTIME_HISTORICAL_SEED)
  const capturePath = path.resolve(process.env.FULLTIME_HISTORICAL_CAPTURE)
  const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `fulltime-historical-${seed.fixtureId}-`))
  const testnet = await createTestnet(4, { host: '127.0.0.1' })
  const repoRoot = path.resolve(__dirname, '../../..')
  const [{ FixturePlanePublisher }, { AuthenticatedFixtureReplay, loadAuthenticatedFixtureArchive }, { createLogger }, { AnswerAttestorService }] = await Promise.all([
    tsImport(path.join(repoRoot, 'apps/worker/src/publisher/fixture-publisher.ts'), __filename),
    tsImport(path.join(repoRoot, 'apps/worker/src/replay/authenticated-fixture-archive.ts'), __filename),
    tsImport(path.join(repoRoot, 'apps/worker/src/logger.ts'), __filename),
    tsImport(path.join(repoRoot, 'apps/attestor/src/service.ts'), __filename)
  ])
  const publisher = new FixturePlanePublisher({
    storageDir: path.join(root, 'fixture-publisher'),
    bootstrap: testnet.bootstrap,
    log: createLogger('error')
  })
  const managers = []
  const actors = new Map()
  let attestor = null
  let attestorTime = null

  try {
    const descriptor = await publisher.open()
    const replay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(capturePath))
    assert.equal(replay.fixture.id, seed.fixtureId)
    await replay.publishFixture(publisher)
    attestor = await new AnswerAttestorService({
      storageDir: path.join(root, 'answer-attestor'),
      fixtureFeedKey: descriptor.key,
      bootstrap: testnet.bootstrap,
      clock: () => attestorTime === null ? Date.now() : attestorTime
    }).open()
    const answerAttestor = {
      servicePublicKey: attestor.descriptor.servicePublicKey,
      receiptFeedKey: attestor.descriptor.receiptFeedKey
    }

    for (const persona of seed.personas) {
      const clock = createHistoricalClock()
      const manager = new RoomManager({
        storagePath: path.join(root, persona.id),
        displayName: persona.displayName,
        fixtureFeedKey: descriptor.key,
        deviceSecret: crypto.randomBytes(32),
        bootstrap: testnet.bootstrap,
        notificationsEnabled: false,
        operationClock: clock.now,
        answerAttestor
      })
      managers.push(manager)
      actors.set(persona.id, { manager, clock })
    }
    await Promise.all(managers.map((manager) => manager.open()))
    await waitFor(async () => {
      const fixtures = await Promise.all(managers.map((manager) => manager.dispatch('fixture.get', { fixtureId: seed.fixtureId })))
      return fixtures.every((value) => value?.fixture?.id === seed.fixtureId)
    }, 'signed fixture replication')

    const result = await seedHistoricalRoom({
      seed,
      actors,
      beforeAction: async ({ action }) => {
        attestorTime = action.at
        await replay.advanceThrough(publisher, action.at)
      }
    })
    const itemActions = seed.actions.filter((action) => ['message', 'quote', 'poll'].includes(action.type))
    const callActions = seed.actions.filter((action) => action.type === 'call')
    assert.equal(replay.complete, true)
    assert.equal(result.actionCount, seed.actions.length)
    assert.equal(result.memberCount, seed.personas.length)
    assert.equal(result.seededItemCount, itemActions.length)
    assert.equal(Object.keys(result.receiptIds).length, callActions.length)

    await waitFor(async () => {
      const states = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: result.roomId })))
      return states.every((state) => state.receipts.length === callActions.length &&
        state.fixture.status === replay.state.status &&
        state.fixture.score?.home === replay.state.score.home &&
        state.fixture.score?.away === replay.state.score.away)
    }, 'room facts and receipt replication', 60_000)

    const states = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: result.roomId })))
    const callsById = new Map()
    for (const action of callActions) {
      const entries = callsById.get(action.callId) || []
      entries.push(action)
      callsById.set(action.callId, entries)
    }
    for (const state of states) {
      assert.equal(state.members.length, seed.personas.length)
      assert.equal(state.items.length, itemActions.length + seed.personas.length)
      assert.equal(state.fixture.status, replay.state.status)
      assert.deepEqual(state.fixture.score, replay.state.score)
      for (const action of itemActions) {
        const item = state.items.find((candidate) => candidate.id === result.itemIds[action.key])
        assert.ok(item, `missing projected item ${action.key}`)
        assert.equal(item.createdAt, action.at)
        if (action.type === 'quote') {
          assert.equal(item.quote.itemId, result.itemIds[action.item])
        }
      }
      for (const [callId, actions] of callsById) {
        const call = state.calls.find((candidate) => candidate.call.id === callId)
        assert.ok(call, `missing call ${callId}`)
        assert.equal(call.status, 'settled')
        assert.equal(call.answers.length, actions.length)
        assert.deepEqual(call.answers.map((answer) => answer.optionId).sort(), actions.map((action) => action.option).sort())
        assert.ok(call.answers.every((answer) => ['correct', 'incorrect'].includes(answer.outcome)))
      }
    }

    const liveMessage = await actors.get(seed.personas[0].id).manager.dispatch('room.message.send', {
      roomId: result.roomId,
      input: { text: 'This message is authored after the historical import.' }
    })
    assert.ok(liveMessage.createdAt > Date.now() - 5_000)
    attestorTime = null
  } finally {
    await Promise.allSettled(managers.map((manager) => manager.close()))
    await attestor?.close().catch(() => {})
    await publisher.close().catch(() => {})
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function waitFor (predicate, label, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
