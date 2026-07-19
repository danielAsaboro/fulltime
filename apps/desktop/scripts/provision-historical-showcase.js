'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { tsImport } = require('tsx/esm/api')
const createTestnet = require('hyperdht/testnet')
const hypercoreCrypto = require('hypercore-crypto')

const { createHistoricalClock, seedHistoricalRoom, validateSeed } = require('../lib/historical-room-seeder.js')
const { parseInviteCode } = require('../lib/invite-code.js')
const { RoomManager } = require('../workers/room-manager.js')

const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '../..')
const workerRoot = path.join(repoRoot, 'apps', 'worker')
const corpusPath = path.resolve(process.env.FULLTIME_SHOWCASE_CORPUS || path.join(repoRoot, 'data', 'world-cup-2026', 'showcase-corpus.json'))
const storageRoot = path.resolve(process.env.FULLTIME_SHOWCASE_STORAGE || path.join(desktopRoot, '.local-development', 'historical-showcase'))
const statePath = path.join(storageRoot, 'state.json')
const roomSummaryPath = path.join(storageRoot, 'rooms.json')
const runtimeRoot = path.join(workerRoot, '.local-development')
const runtimePath = path.join(runtimeRoot, 'replay-runtime.json')
const signingKeyPath = path.join(runtimeRoot, 'manifest-signing-key.pem')
const tlsCertificatePath = path.join(runtimeRoot, 'manifest-tls-cert.pem')
const tlsPrivateKeyPath = path.join(runtimeRoot, 'manifest-tls-key.pem')
const manifestHost = '127.0.0.1'
const manifestPort = 58432
const manifestPath = '/v1/network.json'
const endpoint = `https://${manifestHost}:${manifestPort}${manifestPath}`

let closing = false

async function main () {
  ensureExclusiveRuntime()
  ensureAuthority()
  fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 })
  const corpus = await loadCorpus(corpusPath)
  const persisted = await loadState()
  const [{ FixturePlanePublisher }, { AuthenticatedFixtureReplay, AuthenticatedFixtureScheduleReplay, loadAuthenticatedFixtureArchive, loadAuthenticatedScheduledFixture }, { createLogger }, { AnswerAttestorService }, manifestModule] = await Promise.all([
    tsImport(path.join(workerRoot, 'src/publisher/fixture-publisher.ts'), __filename),
    tsImport(path.join(workerRoot, 'src/replay/authenticated-fixture-archive.ts'), __filename),
    tsImport(path.join(workerRoot, 'src/logger.ts'), __filename),
    tsImport(path.join(repoRoot, 'apps/attestor/src/service.ts'), __filename),
    tsImport(path.join(workerRoot, 'src/network-manifest.ts'), __filename)
  ])
  const modules = { FixturePlanePublisher, AuthenticatedFixtureReplay, AuthenticatedFixtureScheduleReplay, loadAuthenticatedFixtureArchive, loadAuthenticatedScheduledFixture, createLogger, AnswerAttestorService }
  let manifestService = null
  let attestorTime = null
  let publicNetwork = null
  try {
    const pending = corpus.fixtures.filter((fixture) => !persisted.rooms[fixture.fixtureId])
    if (pending.length) {
      // Seed through a real local HyperDHT so fixture discovery is deterministic
      // even when the host's public DHT path is NAT constrained. The exact same
      // persistent stores are reopened on the public DHT after provisioning.
      const testnet = await createTestnet(4, { host: '127.0.0.1' })
      let seedNetwork = null
      try {
        seedNetwork = await openNetwork(modules, corpus, persisted, testnet.bootstrap, () => attestorTime)
        const replays = new Map()
        for (const fixture of pending) {
          const replay = fixture.captureState === 'scheduled-only'
            ? new AuthenticatedFixtureScheduleReplay(await loadAuthenticatedScheduledFixture(fixture.archivePath))
            : new AuthenticatedFixtureReplay(await loadAuthenticatedFixtureArchive(fixture.archivePath))
          if (String(replay.fixture.id) !== fixture.fixtureId) throw new Error(`Archive identity mismatch for ${fixture.fixtureId}`)
          await replay.publishFixture(seedNetwork.publisher)
          replays.set(fixture.fixtureId, replay)
        }
        await seedNetwork.publisher.flush()
        await waitFor(async () => {
          const visible = await Promise.all(seedNetwork.managers.map(async (manager) => {
            const fixtures = await Promise.all(pending.map((fixture) => manager.dispatch('fixture.get', { fixtureId: fixture.fixtureId })))
            return fixtures.every((value, index) => value?.fixture?.id === pending[index].fixtureId)
          }))
          return visible.every(Boolean)
        }, 'signed fixture replication', 90_000)

        for (const fixture of pending) {
          const replay = replays.get(fixture.fixtureId)
          const result = await seedHistoricalRoom({
            seed: fixture.seed,
            actors: seedNetwork.actors,
            waitTimeoutMs: 60_000,
            beforeAction: async ({ action }) => {
              attestorTime = action.at
              await replay.advanceThrough(seedNetwork.publisher, action.at)
            }
          })
          if (!replay.complete) {
            await replay.finish(seedNetwork.publisher)
            await seedNetwork.publisher.flush()
            await waitFor(async () => {
              const states = await Promise.all(seedNetwork.managers.map((manager) => manager.dispatch('fixture.get', { fixtureId: fixture.fixtureId })))
              return states.every((value) => value?.fixture?.status === replay.state.status)
            }, `terminal fixture replication for ${fixture.fixtureId}`, 90_000)
          }
          if (!replay.complete) throw new Error(`Historical replay ${fixture.fixtureId} did not reach its terminal archive record`)
          persisted.rooms[fixture.fixtureId] = {
            seedSha256: fixture.seedSha256,
            roomId: result.roomId,
            inviteCode: result.inviteCode,
            actionCount: result.actionCount,
            memberCount: result.memberCount,
            seededItemCount: result.seededItemCount,
            provisionedAt: Date.now()
          }
          await saveState(persisted, seedNetwork.descriptor.key, seedNetwork.answerAttestor)
          await Promise.all(seedNetwork.managers.map((manager) => manager.suspendRoom(result.roomId)))
          process.stdout.write(`[showcase] provisioned ${fixture.fixtureId} as ${result.roomId}\n`)
        }
      } finally {
        attestorTime = null
        await closeNetwork(seedNetwork)
        await testnet.destroy().catch(() => {})
      }
    }

    publicNetwork = await openNetwork(modules, corpus, persisted, undefined, () => attestorTime, true)
    const { descriptor, answerAttestor } = publicNetwork
    const signingKey = await manifestModule.loadManifestSigningKey(signingKeyPath)
    const manifest = manifestModule.createSignedNetworkManifest({
      fixtureFeedKey: descriptor.key,
      answerAttestor
    }, signingKey)
    manifestService = await manifestModule.startNetworkManifestService({
      manifest,
      host: manifestHost,
      port: manifestPort,
      pathname: manifestPath,
      tlsCertificatePath,
      tlsPrivateKeyPath
    })
    writeRuntime({
      version: 2,
      kind: 'txline-replay',
      pid: process.pid,
      endpoint,
      publicKey: manifestModule.manifestVerificationPublicKey(signingKey),
      caCertificatePath: tlsCertificatePath,
      startedAt: Date.now()
    })

    for (const fixture of corpus.fixtures) {
      const prior = persisted.rooms[fixture.fixtureId]
      if (!prior) throw new Error(`Fixture ${fixture.fixtureId} was not provisioned`)
      if (prior.seedSha256 !== fixture.seedSha256) {
        throw new Error(`Seed ${fixture.fixtureId} changed after provisioning; use a new explicit storage root instead of mutating room history`)
      }
      if (!isUsableInvite(prior.inviteCode, prior.roomId, fixture.fixtureId)) {
        const refreshed = await publicNetwork.actors.get(corpus.creator.id).manager.dispatch('room.invite.regenerate', { roomId: prior.roomId })
        prior.inviteCode = refreshed.code
        prior.inviteRefreshedAt = Date.now()
        await saveState(persisted, descriptor.key, answerAttestor)
      }
    }
    // The operator publishes a complete invite catalog for cross-device
    // promotion capture. Keep each creator-side Blind Pairing responder warm;
    // ordinary desktop/mobile clients retain the bounded six-room LRU.
    for (const fixture of corpus.fixtures) {
      const prior = persisted.rooms[fixture.fixtureId]
      await publicNetwork.actors.get(corpus.creator.id).manager.dispatch('room.get', { roomId: prior.roomId })
    }
    attestorTime = null
    await writeRoomSummary(corpus, persisted, descriptor.key, answerAttestor)
    process.stdout.write(`${JSON.stringify({
      kind: 'fulltime.showcase.provisioned',
      corpus: corpusPath,
      storage: storageRoot,
      fixtureFeedKey: descriptor.key,
      answerAttestor,
      rooms: corpus.fixtures.map((fixture) => {
        const room = persisted.rooms[fixture.fixtureId]
        return {
          fixtureId: fixture.fixtureId,
          roomId: room.roomId,
          actionCount: room.actionCount,
          memberCount: room.memberCount,
          seededItemCount: room.seededItemCount,
          provisionedAt: room.provisionedAt,
          inviteRefreshedAt: room.inviteRefreshedAt
        }
      })
    }, null, 2)}\n`)
    process.stdout.write('[showcase] peers remain online; use the room invite codes on desktop, Android, and iPhone.\n')
    await waitForShutdown()
  } finally {
    closing = true
    await closeNetwork(publicNetwork)
    await manifestService?.close().catch(() => {})
    fs.rmSync(runtimePath, { force: true })
  }
}

function isUsableInvite (code, roomId, fixtureId) {
  if (typeof code !== 'string') return false
  try {
    const parsed = parseInviteCode(code)
    return parsed.preview.roomId === roomId && String(parsed.preview.fixture.id) === fixtureId
  } catch {
    return false
  }
}

async function openNetwork (modules, corpus, persisted, bootstrap, attestorClock, warmCreatorRooms = false) {
  const publisher = new modules.FixturePlanePublisher({
    storageDir: path.join(storageRoot, 'fixture-publisher'),
    log: modules.createLogger('info'),
    ...(bootstrap ? { bootstrap } : {})
  })
  const managers = []
  let attestor = null
  try {
    const descriptor = await publisher.open()
    attestor = await new modules.AnswerAttestorService({
      storageDir: path.join(storageRoot, 'answer-attestor'),
      fixtureFeedKey: descriptor.key,
      expectedServicePublicKey: persisted.answerAttestor?.servicePublicKey,
      expectedReceiptFeedKey: persisted.answerAttestor?.receiptFeedKey,
      ...(bootstrap ? { bootstrap } : {}),
      clock: () => attestorClock() ?? Date.now()
    }).open()
    const answerAttestor = {
      servicePublicKey: attestor.descriptor.servicePublicKey,
      receiptFeedKey: attestor.descriptor.receiptFeedKey
    }
    const actors = new Map()
    for (const persona of corpus.personas) {
      const clock = createHistoricalClock()
      const manager = new RoomManager({
        storagePath: path.join(storageRoot, 'peers', persona.id),
        displayName: persona.displayName,
        fixtureFeedKey: descriptor.key,
        deviceSecret: loadOrCreateDeviceSecret(persona.id),
        ...(bootstrap ? { bootstrap } : {}),
        notificationsEnabled: false,
        maxActiveRoomHandles: warmCreatorRooms && persona.id === corpus.creator.id ? corpus.fixtures.length : undefined,
        openPersistedRooms: !bootstrap,
        operationClock: clock.now,
        answerAttestor
      })
      managers.push(manager)
      actors.set(persona.id, { manager, clock })
    }
    await Promise.all(managers.map((manager) => manager.open()))
    return { publisher, descriptor, attestor, answerAttestor, managers, actors }
  } catch (error) {
    await Promise.allSettled(managers.map((manager) => manager.close()))
    await attestor?.close().catch(() => {})
    await publisher.close().catch(() => {})
    throw error
  }
}

async function closeNetwork (network) {
  if (!network) return
  await Promise.allSettled(network.managers.map((manager) => manager.close()))
  await network.attestor.close().catch(() => {})
  await network.publisher.close().catch(() => {})
}

async function loadCorpus (filename) {
  const value = JSON.parse(await fsPromises.readFile(filename, 'utf8'))
  if (!value || value.schemaVersion !== 1 || value.kind !== 'fulltime.showcase.roomCorpus' || !Array.isArray(value.fixtures) || value.fixtures.length < 1) {
    throw new TypeError('Showcase corpus schema is invalid')
  }
  const fixtureIds = new Set()
  const fixtures = []
  let personas = null
  let priorCreatedAt = 0
  for (const entry of value.fixtures) {
    if (!entry || typeof entry.fixtureId !== 'string' || fixtureIds.has(entry.fixtureId) || typeof entry.seed !== 'string' || typeof entry.archive !== 'string' ||
        !['terminal', 'scheduled-only'].includes(entry.captureState || 'terminal')) {
      throw new TypeError('Showcase corpus fixture entry is invalid or duplicated')
    }
    const seedPath = resolveInsideWorkspace(entry.seed)
    const archivePath = resolveInsideWorkspace(entry.archive)
    const bytes = await fsPromises.readFile(seedPath)
    const seed = validateSeed(JSON.parse(bytes.toString('utf8')))
    if (seed.fixtureId !== entry.fixtureId) throw new Error(`Corpus seed identity mismatch for ${entry.fixtureId}`)
    if (seed.room.createdAt < priorCreatedAt) throw new Error('Showcase corpus fixtures are not in chronological order')
    priorCreatedAt = seed.room.createdAt
    const shape = seed.personas.map(({ id, displayName, creator = false }) => ({ id, displayName, creator }))
    if (personas === null) personas = shape
    else if (JSON.stringify(personas) !== JSON.stringify(shape)) throw new Error(`Persona set differs in fixture ${entry.fixtureId}`)
    fixtureIds.add(entry.fixtureId)
    fixtures.push({
      fixtureId: entry.fixtureId,
      seed,
      seedPath,
      archivePath,
      captureState: entry.captureState || 'terminal',
      seedSha256: crypto.createHash('sha256').update(bytes).digest('hex')
    })
  }
  const creator = personas.find((persona) => persona.creator)
  if (!creator) throw new Error('Showcase corpus has no creator persona')
  return { fixtures, personas, creator }
}

function resolveInsideWorkspace (relative) {
  if (path.isAbsolute(relative)) throw new Error('Showcase corpus paths must be workspace-relative')
  const resolved = path.resolve(repoRoot, relative)
  const workspaceRoot = path.resolve(repoRoot, '..')
  if (resolved !== workspaceRoot && !resolved.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error(`Showcase path escapes the workspace: ${relative}`)
  return resolved
}

async function loadState () {
  try {
    const value = JSON.parse(await fsPromises.readFile(statePath, 'utf8'))
    if (!value || value.version !== 1 || value.kind !== 'fulltime.showcase.provisionState' || !value.rooms || typeof value.rooms !== 'object') {
      throw new Error('Persisted showcase state is invalid')
    }
    return value
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { version: 1, kind: 'fulltime.showcase.provisionState', rooms: {}, answerAttestor: null }
  }
}

async function saveState (state, fixtureFeedKey, answerAttestor) {
  state.fixtureFeedKey = fixtureFeedKey
  state.answerAttestor = answerAttestor
  state.updatedAt = Date.now()
  await atomicJson(statePath, state)
}

async function writeRoomSummary (corpus, state, fixtureFeedKey, answerAttestor) {
  await atomicJson(roomSummaryPath, {
    version: 1,
    kind: 'fulltime.showcase.roomInvites',
    generatedAt: Date.now(),
    fixtureFeedKey,
    answerAttestor,
    rooms: corpus.fixtures.map((fixture) => ({ fixtureId: fixture.fixtureId, ...state.rooms[fixture.fixtureId] }))
  })
}

async function atomicJson (filename, value) {
  await fsPromises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${process.pid}.tmp`
  try {
    await fsPromises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await fsPromises.rename(temporary, filename)
    await fsPromises.chmod(filename, 0o600)
  } finally {
    await fsPromises.rm(temporary, { force: true })
  }
}

function loadOrCreateDeviceSecret (personaId) {
  const directory = path.join(storageRoot, 'device-secrets')
  const filename = path.join(directory, `${personaId}.bin`)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    const existing = fs.readFileSync(filename)
    if (existing.length !== 32) throw new Error(`Persistent device secret for ${personaId} has invalid length`)
    return existing
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const secret = hypercoreCrypto.randomBytes(32)
    fs.writeFileSync(filename, secret, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(filename, 0o600)
    return secret
  }
}

function ensureExclusiveRuntime () {
  let runtime
  try { runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8')) } catch { return }
  if (!Number.isSafeInteger(runtime.pid) || runtime.pid < 1) throw new Error(`Refusing to overwrite invalid operator runtime ${runtimePath}`)
  try {
    process.kill(runtime.pid, 0)
    throw new Error(`Operator process ${runtime.pid} already owns ${runtimePath}`)
  } catch (error) {
    if (error.message.startsWith('Operator process')) throw error
    if (error.code === 'EPERM') throw new Error(`Operator process ${runtime.pid} may still own ${runtimePath}`)
    fs.rmSync(runtimePath, { force: true })
  }
}

function ensureAuthority () {
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(signingKeyPath)) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(signingKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  }
  const current = fs.existsSync(tlsCertificatePath) && fs.existsSync(tlsPrivateKeyPath) &&
    spawnSync('openssl', ['x509', '-checkend', '86400', '-noout', '-in', tlsCertificatePath], { stdio: 'ignore' }).status === 0
  if (current) return
  fs.rmSync(tlsCertificatePath, { force: true })
  fs.rmSync(tlsPrivateKeyPath, { force: true })
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30',
    '-keyout', tlsPrivateKeyPath, '-out', tlsCertificatePath,
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'
  ], { stdio: 'ignore' })
  if (result.status !== 0) throw new Error('Could not generate the local showcase TLS certificate')
  fs.chmodSync(tlsPrivateKeyPath, 0o600)
  fs.chmodSync(tlsCertificatePath, 0o600)
}

function writeRuntime (value) {
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true, mode: 0o700 })
  const temporary = `${runtimePath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, runtimePath)
    fs.chmodSync(runtimePath, 0o600)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

async function waitFor (predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try { if (await predicate()) return } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function waitForShutdown () {
  return new Promise((resolve) => {
    const stop = () => {
      if (closing) return
      closing = true
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

main().catch((error) => {
  fs.rmSync(runtimePath, { force: true })
  console.error(`[fulltime showcase] ${error.stack || error.message}`)
  process.exitCode = 1
})
