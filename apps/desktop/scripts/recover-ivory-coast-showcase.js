'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { tsImport } = require('tsx/esm/api')
const createTestnet = require('hyperdht/testnet')

const { createHistoricalClock, validateSeed } = require('../lib/historical-room-seeder.js')
const { RoomManager } = require('../workers/room-manager.js')

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '../..')
const workerRoot = path.join(repoRoot, 'apps', 'worker')
const storageRoot = path.join(desktopRoot, '.local-development', 'historical-showcase')
const statePath = path.join(storageRoot, 'state.json')
const seedPath = path.join(repoRoot, 'data', 'world-cup-2026', '17588239-ivory-coast-vs-ecuador', 'room-seed.json')
const archivePath = path.resolve(repoRoot, '../resources/fixtures/world-cup-2026/17588239-ivory-coast-vs-ecuador')
const fixtureId = '17588239'
const resumeAt = 1781481769041

async function main () {
  const state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'))
  if (state.rooms?.[fixtureId]) {
    process.stdout.write(`[showcase recovery] ${fixtureId} is already recorded; nothing to do\n`)
    return
  }
  const seedBytes = await fsPromises.readFile(seedPath)
  const seed = validateSeed(JSON.parse(seedBytes.toString('utf8')))
  const startIndex = seed.actions.findIndex((action) => action.at === resumeAt && action.type === 'reply')
  if (startIndex < 1) throw new Error('Recovery boundary is absent from the current seed')

  const [{ FixturePlanePublisher }, { AuthenticatedFixtureReplay, loadAuthenticatedFixtureArchive }, { createLogger }, { AnswerAttestorService }] = await Promise.all([
    tsImport(path.join(workerRoot, 'src/publisher/fixture-publisher.ts'), __filename),
    tsImport(path.join(workerRoot, 'src/replay/authenticated-fixture-archive.ts'), __filename),
    tsImport(path.join(workerRoot, 'src/logger.ts'), __filename),
    tsImport(path.join(repoRoot, 'apps/attestor/src/service.ts'), __filename)
  ])

  const testnet = await createTestnet(4, { host: '127.0.0.1' })
  let publisher = null
  let attestor = null
  const managers = []
  try {
    publisher = new FixturePlanePublisher({
      storageDir: path.join(storageRoot, 'fixture-publisher'),
      log: createLogger('info'),
      bootstrap: testnet.bootstrap
    })
    const descriptor = await publisher.open()
    if (descriptor.key !== state.fixtureFeedKey) throw new Error('Recovery fixture feed does not match the persisted authority')
    attestor = await new AnswerAttestorService({
      storageDir: path.join(storageRoot, 'answer-attestor'),
      fixtureFeedKey: descriptor.key,
      expectedServicePublicKey: state.answerAttestor?.servicePublicKey,
      expectedReceiptFeedKey: state.answerAttestor?.receiptFeedKey,
      bootstrap: testnet.bootstrap
    }).open()
    const answerAttestor = {
      servicePublicKey: attestor.descriptor.servicePublicKey,
      receiptFeedKey: attestor.descriptor.receiptFeedKey
    }
    const actors = new Map()
    for (const persona of seed.personas) {
      const clock = createHistoricalClock()
      const manager = new RoomManager({
        storagePath: path.join(storageRoot, 'peers', persona.id),
        displayName: persona.displayName,
        fixtureFeedKey: descriptor.key,
        deviceSecret: fs.readFileSync(path.join(storageRoot, 'device-secrets', `${persona.id}.bin`)),
        bootstrap: testnet.bootstrap,
        notificationsEnabled: false,
        operationClock: clock.now,
        answerAttestor
      })
      managers.push(manager)
      actors.set(persona.id, { manager, clock })
    }
    await Promise.all(managers.map((manager) => manager.open()))

    const creator = actors.get(seed.personas.find((persona) => persona.creator).id)
    const candidates = (await creator.manager.dispatch('room.list'))
      .filter((entry) => String(entry.fixture?.id) === fixtureId)
    const projected = []
    for (const candidate of candidates) {
      const roomId = candidate.room.id
      const roomState = await creator.manager.dispatch('room.state', { roomId })
      const opening = roomState.calls.find((entry) => entry.call.id === `call:${fixtureId}:20:phase:kickoff:opening-goal`)
      if (roomState.members.length === seed.personas.length && opening?.answers.length === 3 && roomState.items.some((item) => item.createdAt === 1781481179041)) {
        projected.push({ roomId, roomState })
      }
    }
    if (projected.length !== 1) throw new Error(`Expected one resumable ${fixtureId} room, found ${projected.length}`)
    const { roomId, roomState } = projected[0]
    const itemIds = new Map()
    for (const action of seed.actions.slice(0, startIndex)) {
      if (!['message', 'quote', 'poll'].includes(action.type)) continue
      const item = roomState.items.find((candidate) =>
        candidate.createdAt === action.at &&
        (action.type === 'poll' ? candidate.kind === 'poll' : candidate.text === action.text)
      )
      if (!item) throw new Error(`Could not map previously persisted action ${action.key}`)
      itemIds.set(action.key, item.id)
    }

    const replay = new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(archivePath))
    for (const action of seed.actions.slice(startIndex)) {
      await replay.advanceThrough(publisher, action.at)
      const runtime = actors.get(action.actor)
      runtime.clock.set(action.at)
      if (action.type === 'message') {
        const item = await runtime.manager.dispatch('room.message.send', { roomId, input: { text: action.text } })
        if (action.key) itemIds.set(action.key, item.id)
      } else if (action.type === 'quote') {
        const quotedItemId = requiredItem(itemIds, action.item)
        await waitForItem(runtime.manager, roomId, quotedItemId)
        const item = await runtime.manager.dispatch('room.message.send', { roomId, input: { text: action.text, quotedItemId } })
        if (action.key) itemIds.set(action.key, item.id)
      } else if (action.type === 'reply') {
        const itemId = requiredItem(itemIds, action.item)
        await waitForItem(runtime.manager, roomId, itemId)
        await runtime.manager.dispatch('room.reply.send', { roomId, itemId, input: { text: action.text } })
      } else if (action.type === 'reaction') {
        const itemId = requiredItem(itemIds, action.item)
        await waitForItem(runtime.manager, roomId, itemId)
        await runtime.manager.dispatch('room.item.react', { roomId, itemId, emoji: action.emoji })
      } else {
        throw new Error(`Recovery encountered unsupported post-boundary action ${action.type}`)
      }
    }
    if (!replay.complete) throw new Error('Recovered fixture replay did not reach its terminal record')

    const expectedItems = seed.actions.filter((action) => ['message', 'quote', 'poll'].includes(action.type)).length
    await waitFor(async () => {
      const values = await Promise.all(managers.map((manager) => manager.dispatch('room.state', { roomId })))
      return values.every((value) => value.members.length === seed.personas.length && value.items.length >= expectedItems + seed.personas.length)
    }, 'recovered room replication', 60_000)
    const refreshed = await creator.manager.dispatch('room.invite.regenerate', { roomId })
    state.rooms[fixtureId] = {
      seedSha256: crypto.createHash('sha256').update(seedBytes).digest('hex'),
      roomId,
      inviteCode: refreshed.code,
      actionCount: seed.actions.length,
      memberCount: seed.personas.length,
      seededItemCount: expectedItems,
      provisionedAt: Date.now(),
      recoveredAt: Date.now()
    }
    state.fixtureFeedKey = descriptor.key
    state.answerAttestor = answerAttestor
    state.updatedAt = Date.now()
    await atomicJson(statePath, state)
    process.stdout.write(`[showcase recovery] recovered ${fixtureId}: ${seed.actions.length} actions, ${seed.personas.length} members\n`)
  } finally {
    for (const manager of managers) await manager.close().catch(() => {})
    await attestor?.close().catch(() => {})
    await publisher?.close().catch(() => {})
    await testnet.destroy().catch(() => {})
  }
}

function requiredItem (itemIds, key) {
  const value = itemIds.get(key)
  if (!value) throw new Error(`Recovery item ${key} is unavailable`)
  return value
}

async function waitForItem (manager, roomId, itemId) {
  await waitFor(async () => (await manager.dispatch('room.state', { roomId })).items.some((item) => item.id === itemId), `item ${itemId}`, 60_000)
}

async function waitFor (predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try { if (await predicate()) return } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

async function atomicJson (filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`
  try {
    await fsPromises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await fsPromises.rename(temporary, filename)
    await fsPromises.chmod(filename, 0o600)
  } finally {
    await fsPromises.rm(temporary, { force: true })
  }
}

main().catch((error) => {
  console.error(`[showcase recovery] ${error.stack || error.message}`)
  process.exitCode = 1
})
