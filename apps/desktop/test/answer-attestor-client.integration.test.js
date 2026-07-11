'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const b4a = require('b4a')
const Corestore = require('corestore')
const createTestnet = require('hyperdht/testnet')
const crypto = require('hypercore-crypto')
const Hyperswarm = require('hyperswarm')
const { tsImport } = require('tsx/esm/api')

const { verifyAnswerAcceptanceToken } = require('../lib/answer-attestation.js')
const { AccountStore } = require('../workers/account-store.js')
const { AttestationRejectedError, AnswerAttestorClient } = require('../workers/answer-attestor-client.js')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1'

test('desktop client attests against the real service and persists the pinned receipt before returning', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1 to bind a local DHT',
  timeout: 90_000
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-desktop-attestor-'))
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const publisher = new CallPublisher(path.join(root, 'publisher'), testnet.bootstrap)
  let service = null

  try {
    await publisher.open()
    const now = Date.now()
    const call = callRecord(now)
    await publisher.publish(call)
    service = await startAttestorService({
      storagePath: path.join(root, 'service'),
      fixtureFeedKey: publisher.key,
      bootstrap: testnet.bootstrap
    })
    await waitFor(() => publisher.swarm.connections.size > 0, 'attestor fixture-feed connection', 15_000)
    const pins = {
      servicePublicKey: service.descriptor.servicePublicKey,
      receiptFeedKey: service.descriptor.receiptFeedKey,
      fixtureFeedKey: publisher.key
    }
    const answer = {
      requestId: 'request:pear-client:0001',
      answerId: 'answer:pear-client:0001',
      callId: call.call.id,
      optionId: 'home',
      submittedAt: now
    }
    const storagePath = path.join(root, 'desktop-client')
    const deviceSecret = crypto.randomBytes(32)
    const first = await runNodeClient({
      mode: 'submit',
      storagePath,
      deviceSecret,
      bootstrap: testnet.bootstrap,
      ...pins,
      answer
    })
    assert.equal(first.replayCode, 'REQUEST_REPLAYED')
    assert.deepEqual(first.stored, first.token)
    assert.equal(first.token.claims.submission.userId, first.userId)
    assert.deepEqual(verifyAnswerAcceptanceToken(first.token, pins), first.token)

    const restarted = await runNodeClient({
      mode: 'read',
      storagePath,
      deviceSecret,
      bootstrap: testnet.bootstrap,
      ...pins,
      requestId: answer.requestId
    })
    assert.deepEqual(restarted.stored, first.token)
    deviceSecret.fill(0)
  } finally {
    await service?.close().catch(() => {})
    await publisher.close().catch(() => {})
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

class CallPublisher {
  constructor (storagePath, bootstrap) {
    this.storagePath = storagePath
    this.bootstrap = bootstrap
    this.store = null
    this.core = null
    this.swarm = null
    this.discovery = null
  }

  get key () {
    return b4a.toString(this.core.key, 'hex')
  }

  async open () {
    this.store = new Corestore(this.storagePath)
    await this.store.ready()
    this.core = this.store.get({ name: 'desktop-attestor-fixture-feed', active: true })
    await this.core.ready()
    this.swarm = new Hyperswarm({ bootstrap: this.bootstrap })
    this.swarm.on('connection', (connection) => this.store.replicate(connection))
    this.discovery = this.swarm.join(this.core.discoveryKey, { server: true, client: false })
    await this.discovery.flushed()
  }

  async publish (record) {
    await this.core.append(b4a.from(JSON.stringify(record)))
  }

  async close () {
    await this.discovery?.destroy().catch(() => {})
    await this.swarm?.destroy().catch(() => {})
    await this.store?.close().catch(() => {})
  }
}

function callRecord (now) {
  return {
    version: 1,
    kind: 'call.open',
    publishedAt: now,
    call: {
      id: 'call:pear-client:1',
      fixtureId: 'fixture:pear-client:1',
      roomId: null,
      template: 'next-event',
      spec: { kind: 'next-event', event: 'goal' },
      prompt: 'Who scores next?',
      options: [
        { id: 'home', label: 'Home' },
        { id: 'away', label: 'Away' }
      ],
      openedAt: now - 1000,
      locksAt: now + 30_000,
      settlesBy: now + 90_000,
      scored: true,
      status: 'open'
    }
  }
}

async function startAttestorService ({ storagePath, fixtureFeedKey, bootstrap }) {
  const repoRoot = path.resolve(__dirname, '../../..')
  const entry = path.join(repoRoot, 'apps/attestor/src/service.ts')
  const { AnswerAttestorService } = await tsImport(entry, __filename)
  const instance = await new AnswerAttestorService({
    storageDir: storagePath,
    fixtureFeedKey,
    bootstrap
  }).open()
  return {
    descriptor: instance.descriptor,
    close: () => instance.close()
  }
}

async function runNodeClient (config) {
  const store = new Corestore(config.storagePath)
  await store.ready()
  const swarm = new Hyperswarm({ bootstrap: config.bootstrap, maxPeers: 8 })
  const account = new AccountStore(store, 'Node probe', { deviceSecret: config.deviceSecret })
  await account.ready()
  const client = new AnswerAttestorClient({
    store,
    swarm,
    account,
    servicePublicKey: config.servicePublicKey,
    receiptFeedKey: config.receiptFeedKey,
    fixtureFeedKey: config.fixtureFeedKey,
    requestTimeoutMs: 10_000
  })
  swarm.on('connection', (connection, peerInfo) => {
    store.replicate(connection)
    client.addConnection(connection, peerInfo)
  })
  try {
    await client.open()
    if (config.mode === 'read') {
      return { stored: await client.getAcceptedByRequest(config.requestId) }
    }
    let lastError = null
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const token = await client.submit(config.answer)
        const stored = await client.getAcceptedByRequest(config.answer.requestId)
        let replayCode = null
        try { await client.submit(config.answer) } catch (error) {
          if (!(error instanceof AttestationRejectedError)) throw error
          replayCode = error.code
        }
        return { token, stored, replayCode, userId: account.userId }
      } catch (error) {
        lastError = error
        if (!(error instanceof AttestationRejectedError) || !error.recoverable ||
            !['CALL_UNKNOWN', 'FEED_UNAVAILABLE'].includes(error.code)) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw lastError
  } finally {
    await client.close().catch(() => {})
    await swarm.destroy().catch(() => {})
    await account.close().catch(() => {})
    await store.close().catch(() => {})
  }
}

async function waitFor (predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${label} timed out`)
}
