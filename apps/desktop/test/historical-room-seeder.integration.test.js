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

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1'
const firstSeedPath = path.resolve(__dirname, '../../../data/world-cup-2026/17588227-mexico-vs-south-africa/room-seed.json')
const secondSeedPath = path.resolve(__dirname, '../../../data/world-cup-2026/17926696-south-korea-vs-czech-republic/room-seed.json')
const thirdSeedPath = path.resolve(__dirname, '../../../data/world-cup-2026/17926604-canada-vs-bosnia-herzegovina/room-seed.json')
const fourthSeedPath = path.resolve(__dirname, '../../../data/world-cup-2026/18209181-france-vs-morocco/room-seed.json')
const firstCapturePath = path.resolve(__dirname, '../../../../resources/fixtures/world-cup-2026/17588227-mexico-vs-south-africa')
const secondCapturePath = path.resolve(__dirname, '../../../../resources/fixtures/world-cup-2026/17926696-south-korea-vs-czech-republic')
const thirdCapturePath = path.resolve(__dirname, '../../../../resources/fixtures/world-cup-2026/17926604-canada-vs-bosnia-herzegovina')
const fourthCapturePath = path.resolve(__dirname, '../../../../resources/fixtures/world-cup-2026/18209181-france-vs-morocco')

test('historical rooms seed sequentially through signed fixture discovery, blind pairing, and replicated Autobase operations', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1 to bind a local DHT testnet',
  timeout: 720_000
}, async () => {
  const firstSeed = JSON.parse(await fs.readFile(firstSeedPath, 'utf8'))
  const secondSeed = JSON.parse(await fs.readFile(secondSeedPath, 'utf8'))
  const thirdSeed = JSON.parse(await fs.readFile(thirdSeedPath, 'utf8'))
  const fourthSeed = JSON.parse(await fs.readFile(fourthSeedPath, 'utf8'))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-historical-room-'))
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
  const actors = new Map()
  const managers = []
  let attestor = null
  let attestorTime = null

  try {
    const descriptor = await publisher.open()
    const firstReplay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(firstCapturePath))
    const secondReplay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(secondCapturePath))
    const thirdReplay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(thirdCapturePath))
    const fourthReplay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(fourthCapturePath))
    await firstReplay.publishFixture(publisher)
    await secondReplay.publishFixture(publisher)
    await thirdReplay.publishFixture(publisher)
    await fourthReplay.publishFixture(publisher)
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

    for (const persona of firstSeed.personas) {
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
      const fixtureSets = await Promise.all(managers.map(async (manager) => ({
        first: await manager.dispatch('fixture.get', { fixtureId: firstSeed.fixtureId }),
        second: await manager.dispatch('fixture.get', { fixtureId: secondSeed.fixtureId }),
        third: await manager.dispatch('fixture.get', { fixtureId: thirdSeed.fixtureId }),
        fourth: await manager.dispatch('fixture.get', { fixtureId: fourthSeed.fixtureId })
      })))
      return fixtureSets.every(({ first, second, third, fourth }) =>
        first?.fixture?.home?.name === 'Mexico' && first?.fixture?.away?.name === 'South Africa' &&
        second?.fixture?.home?.name === 'South Korea' && second?.fixture?.away?.name === 'Czech Republic' &&
        third?.fixture?.home?.name === 'Canada' && third?.fixture?.away?.name === 'Bosnia & Herzegovina' &&
        fourth?.fixture?.home?.name === 'France' && fourth?.fixture?.away?.name === 'Morocco'
      )
    }, 'signed fixture replication')

    const firstResult = await seedHistoricalRoom({
      seed: firstSeed,
      actors,
      beforeAction: async ({ action }) => {
        attestorTime = action.at
        await firstReplay.advanceThrough(publisher, action.at)
      }
    })
    assert.equal(firstReplay.complete, true)
    assert.equal(firstResult.fixtureId, firstSeed.fixtureId)
    assert.equal(firstResult.actionCount, firstSeed.actions.length)
    assert.equal(firstResult.memberCount, 4)
    assert.equal(firstResult.seededItemCount, 14)
    assert.equal(firstResult.projectedItemCount, 18)
    assert.equal(Object.keys(firstResult.receiptIds).length, 2)
    let firstReceiptSummary = []
    try {
      await waitFor(async () => {
        const replicated = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: firstResult.roomId })))
        firstReceiptSummary = replicated.map((state) => ({
          answers: state.calls.find((entry) => entry.call.id === 'call:17588227:504:phase:half-time:second-half-fast-start')?.answers.length ?? 0,
          unverified: state.unverifiedAnswerReferences,
          errors: state.receiptVerificationErrors
        }))
        return firstReceiptSummary.every((entry) => entry.answers === 2)
      }, 'first-room answer receipt replication')
    } catch (error) {
      throw new Error(`${error.message}; observed=${JSON.stringify(firstReceiptSummary)}`)
    }

    const states = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: firstResult.roomId })))
    for (const state of states) {
      assert.equal(state.members.length, 4)
      assert.equal(state.items.length, 18)

      const openingCall = state.items.find((item) => item.id === firstResult.itemIds['amina-mexico-2-0'])
      assert.equal(openingCall.text, 'Azteca. Opening game. Write it down — Mexico 2-0.')
      assert.equal(openingCall.replies.length, 1)
      assert.deepEqual(openingCall.reactions.map((reaction) => reaction.emoji), ['😮'])

      const receipt = state.items.find((item) => item.id === firstResult.itemIds['amina-exact-receipt'])
      assert.equal(receipt.quote.itemId, openingCall.id)
      assert.equal(receipt.quote.text, openingCall.text)
      assert.equal(receipt.quote.author.displayName, 'Amina')
      assert.equal(receipt.replies[0].text, 'Fair. Exact score and everything. You know ball today.')
      assert.deepEqual(receipt.reactions.map((reaction) => reaction.emoji), ['👏'])

      const poll = state.items.find((item) => item.kind === 'poll' && item.poll.id === firstResult.pollIds['opening-night-winner'])
      assert.deepEqual(poll.poll.options.map((option) => option.votes), [2, 1, 1])
      const fastStart = state.calls.find((entry) => entry.call.id === 'call:17588227:504:phase:half-time:second-half-fast-start')
      assert.equal(fastStart.status, 'settled')
      assert.equal(fastStart.settlement.outcome.winningOption, 'no')
      assert.deepEqual(fastStart.answers.map((answer) => answer.outcome).sort(), ['correct', 'incorrect'])
      assert.equal(state.timeline.filter((event) => event.kind === 'goal').length, 2)
      assert.deepEqual(state.fixture.score, { home: 2, away: 0 })
    }

    const creatorState = states[0]
    assert.equal(creatorState.items.find((item) => item.id === firstResult.itemIds['quinones-opener']).createdAt, 1781205340473)
    assert.equal(creatorState.items.find((item) => item.id === firstResult.itemIds['jimenez-second']).createdAt, 1781210054424)

    const secondResult = await seedHistoricalRoom({
      seed: secondSeed,
      actors,
      beforeAction: async ({ action }) => {
        attestorTime = action.at
        await secondReplay.advanceThrough(publisher, action.at)
      }
    })
    assert.equal(secondReplay.complete, true)
    assert.equal(secondResult.fixtureId, secondSeed.fixtureId)
    assert.equal(secondResult.actionCount, secondSeed.actions.length)
    assert.equal(secondResult.memberCount, 4)
    assert.equal(secondResult.seededItemCount, 14)
    assert.equal(secondResult.projectedItemCount, 18)
    assert.equal(Object.keys(secondResult.receiptIds).length, 2)
    await waitFor(async () => {
      const replicated = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: secondResult.roomId })))
      return replicated.every((state) => state.calls.find((entry) => entry.call.id === 'call:17926696:463:phase:half-time:second-half-fast-start')?.answers.length === 2)
    }, 'second-room answer receipt replication')

    const secondStates = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: secondResult.roomId })))
    for (const state of secondStates) {
      assert.equal(state.members.length, 4)
      assert.equal(state.items.length, 18)
      const koreaCall = state.items.find((item) => item.id === secondResult.itemIds['amina-korea-call'])
      assert.equal(koreaCall.text, 'Son starts and the model has Korea at 74%. Korea win. Lock it.')
      assert.equal(koreaCall.replies[0].author.displayName, 'Tunde')
      assert.deepEqual(koreaCall.reactions.map((reaction) => reaction.emoji), ['🔥'])
      const gotcha = state.items.find((item) => item.id === secondResult.itemIds['tunde-model-gotcha'])
      assert.equal(gotcha.quote.itemId, koreaCall.id)
      const receipt = state.items.find((item) => item.id === secondResult.itemIds['amina-korea-receipt'])
      assert.equal(receipt.quote.itemId, koreaCall.id)
      assert.equal(receipt.createdAt, 1781236783281)
      const missedDraw = state.items.find((item) => item.id === secondResult.itemIds['maya-draw-miss'])
      assert.equal(missedDraw.quote.itemId, secondResult.itemIds['maya-one-one'])
      const poll = state.items.find((item) => item.kind === 'poll' && item.poll.id === secondResult.pollIds['guadalajara-winner'])
      assert.deepEqual(poll.poll.options.map((option) => option.votes), [2, 1, 1])
      const fastStart = state.calls.find((entry) => entry.call.id === 'call:17926696:463:phase:half-time:second-half-fast-start')
      assert.equal(fastStart.status, 'settled')
      assert.equal(fastStart.settlement.outcome.winningOption, 'no')
      assert.deepEqual(fastStart.answers.map((answer) => answer.outcome).sort(), ['correct', 'incorrect'])
      assert.equal(state.timeline.filter((event) => event.kind === 'goal').length, 3)
      assert.deepEqual(state.fixture.score, { home: 2, away: 1 })
    }

    const thirdResult = await seedHistoricalRoom({
      seed: thirdSeed,
      actors,
      beforeAction: async ({ action }) => {
        attestorTime = action.at
        await thirdReplay.advanceThrough(publisher, action.at)
      }
    })
    assert.equal(thirdReplay.complete, true)
    assert.equal(thirdResult.fixtureId, thirdSeed.fixtureId)
    assert.equal(thirdResult.actionCount, thirdSeed.actions.length)
    assert.equal(thirdResult.memberCount, 4)
    assert.equal(thirdResult.seededItemCount, 15)
    assert.equal(thirdResult.projectedItemCount, 19)
    assert.equal(Object.keys(thirdResult.receiptIds).length, 4)
    await waitFor(async () => {
      const replicated = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: thirdResult.roomId })))
      return replicated.every((state) => {
        const opening = state.calls.find((entry) => entry.call.id === 'call:17926604:17:phase:kickoff:opening-goal')
        const fastStart = state.calls.find((entry) => entry.call.id === 'call:17926604:547:phase:half-time:second-half-fast-start')
        return state.receipts.length === 4 &&
          state.fixture.status === 'full-time' &&
          state.fixture.score?.home === 1 && state.fixture.score?.away === 1 &&
          opening?.status === 'settled' && fastStart?.status === 'settled'
      })
    }, 'third-room answer receipt replication')

    const thirdStates = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: thirdResult.roomId })))
    for (const state of thirdStates) {
      assert.equal(state.members.length, 4)
      assert.equal(state.items.length, 19)
      assert.deepEqual(state.fixture.score, { home: 1, away: 1 })
      assert.equal(state.fixture.status, 'full-time')
      assert.equal(state.timeline.filter((event) => event.kind === 'goal').length, 2)
      assert.equal(state.timeline.filter((event) => event.kind === 'full-time').length, 1)
      assert.equal(state.timeline.filter((event) => event.kind === 'second-half-start').length, 1)
      const exact = state.items.find((item) => item.id === thirdResult.itemIds['tunde-exact-receipt'])
      assert.equal(exact.quote.itemId, thirdResult.itemIds['tunde-one-one'])
      assert.equal(exact.createdAt, 1781297883021)
      const opening = state.calls.find((entry) => entry.call.id === 'call:17926604:17:phase:kickoff:opening-goal')
      const fastStart = state.calls.find((entry) => entry.call.id === 'call:17926604:547:phase:half-time:second-half-fast-start')
      for (const call of [opening, fastStart]) {
        assert.equal(call.status, 'settled')
        assert.equal(call.settlement.outcome.winningOption, 'no')
        assert.deepEqual(call.answers.map((answer) => answer.outcome).sort(), ['correct', 'incorrect'])
      }
    }

    const fourthResult = await seedHistoricalRoom({
      seed: fourthSeed,
      actors,
      beforeAction: async ({ action }) => {
        attestorTime = action.at
        await fourthReplay.advanceThrough(publisher, action.at)
      }
    })
    assert.equal(fourthReplay.complete, true)
    assert.equal(fourthResult.fixtureId, fourthSeed.fixtureId)
    assert.equal(fourthResult.actionCount, fourthSeed.actions.length)
    assert.equal(fourthResult.memberCount, 4)
    assert.equal(fourthResult.seededItemCount, 12)
    assert.equal(fourthResult.projectedItemCount, 16)
    assert.equal(Object.keys(fourthResult.receiptIds).length, 8)
    await waitFor(async () => {
      const replicated = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: fourthResult.roomId })))
      return replicated.every((state) => {
        const opening = state.calls.find((entry) => entry.call.id === 'call:18209181:19:phase:kickoff:opening-goal')
        const fastStart = state.calls.find((entry) => entry.call.id === 'call:18209181:548:phase:half-time:second-half-fast-start')
        const nextGoal = state.calls.find((entry) => entry.call.id === 'call:18209181:548:phase:half-time:next-goal-second-half')
        const anotherGoal = state.calls.find((entry) => entry.call.id === 'call:18209181:739:goal:another-goal')
        return state.receipts.length === 8 &&
          state.fixture.status === 'full-time' &&
          state.fixture.score?.home === 2 && state.fixture.score?.away === 0 &&
          [opening, fastStart, nextGoal, anotherGoal].every((entry) => entry?.status === 'settled')
      })
    }, 'fourth-room answer receipt replication')

    const fourthStates = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId: fourthResult.roomId })))
    for (const state of fourthStates) {
      assert.equal(state.members.length, 4)
      assert.equal(state.items.length, 16)
      assert.deepEqual(state.fixture.score, { home: 2, away: 0 })
      assert.equal(state.fixture.status, 'full-time')
      assert.equal(state.timeline.filter((event) => event.kind === 'goal').length, 2)
      assert.equal(state.timeline.filter((event) => event.kind === 'full-time').length, 1)

      const wrongScore = state.items.find((item) => item.id === fourthResult.itemIds['tunde-three-one-miss'])
      assert.equal(wrongScore.quote.itemId, fourthResult.itemIds['tunde-france-three-one'])
      assert.equal(wrongScore.createdAt, 1783634446507)
      const attackReceipt = state.items.find((item) => item.id === fourthResult.itemIds['amina-attack-receipt'])
      assert.equal(attackReceipt.quote.itemId, fourthResult.itemIds['amina-france-attack'])
      assert.deepEqual(attackReceipt.reactions.map((reaction) => reaction.emoji), ['👏'])
      const falseOpener = state.items.find((item) => item.id === fourthResult.itemIds['morocco-false-opener'])
      assert.equal(falseOpener.replies[0].author.displayName, 'Amina')
      assert.deepEqual(falseOpener.reactions.map((reaction) => reaction.emoji), ['😮'])
      const poll = state.items.find((item) => item.kind === 'poll' && item.poll.id === fourthResult.pollIds['boston-quarterfinal'])
      assert.deepEqual(poll.poll.options.map((option) => option.votes), [2, 1, 1])

      const outcomes = new Map(state.calls.map((entry) => [entry.call.id, entry]))
      assert.equal(outcomes.get('call:18209181:19:phase:kickoff:opening-goal').settlement.outcome.winningOption, 'no')
      assert.equal(outcomes.get('call:18209181:548:phase:half-time:second-half-fast-start').settlement.outcome.winningOption, 'no')
      assert.equal(outcomes.get('call:18209181:548:phase:half-time:next-goal-second-half').settlement.outcome.winningOption, 'home')
      assert.equal(outcomes.get('call:18209181:739:goal:another-goal').settlement.outcome.winningOption, 'yes')
      for (const callId of [
        'call:18209181:19:phase:kickoff:opening-goal',
        'call:18209181:548:phase:half-time:second-half-fast-start',
        'call:18209181:548:phase:half-time:next-goal-second-half',
        'call:18209181:739:goal:another-goal'
      ]) {
        assert.deepEqual(outcomes.get(callId).answers.map((answer) => answer.outcome).sort(), ['correct', 'incorrect'])
      }
    }

    const liveMessage = await actors.get('fan_b').manager.dispatch('room.message.send', {
      roomId: fourthResult.roomId,
      input: { text: 'This message is authored after the historical import.' }
    })
    assert.ok(liveMessage.createdAt > Date.now() - 5_000, 'historical operation clocks must reset after import')
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
