'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const FramedStream = require('framed-stream')
const createTestnet = require('hyperdht/testnet')
const PearRuntime = require('pear-runtime')

const {
  MAX_IPC_FRAME_BYTES,
  PROTOCOL_VERSION,
  encodeJsonFrame,
  parseJsonFrame,
  validateWorkerFrame
} = require('../lib/protocol.js')
const { deriveDevelopmentTopic } = require('../lib/topic.js')

const REQUEST_TIMEOUT_MS = 8_000
const EXIT_TIMEOUT_MS = 4_000
const MAX_RECORDED_FRAMES = 256
const LOCAL_TIMEOUTS = { discovery: 20_000, hard: 45_000 }
const PUBLIC_TIMEOUTS = { discovery: 75_000, hard: 105_000 }

function smokeMode(args) {
  const local = args.includes('--local')
  const publicDht = args.includes('--public')
  if (local && publicDht) throw new TypeError('Choose either --local or --public')
  return publicDht ? 'public' : 'local'
}

function id() {
  return crypto.randomUUID()
}

function withTimeout(promise, timeoutMs, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

class RuntimePeer {
  constructor({ name, roomCode, storagePath, topicHex, bootstrap }) {
    this.name = name
    this.frames = []
    this.waiters = new Set()
    this.failure = null
    this.exited = false

    const workerPath = require.resolve('../workers/transport.js')
    const workerArgs = [
      '--storage', storagePath,
      '--room', roomCode,
      '--name', name,
      '--topic', topicHex
    ]
    if (bootstrap) workerArgs.push('--bootstrap', JSON.stringify(bootstrap))
    this.worker = PearRuntime.run(workerPath, workerArgs)
    this.pipe = new FramedStream(this.worker, { bits: 16 })

    this.pipe.on('data', (data) => this.onData(data))
    this.pipe.on('error', (error) => this.fail(new Error(`${this.name} IPC failed: ${error.message}`)))
    if (this.worker.stderr) {
      this.worker.stderr.on('data', (data) => process.stderr.write(`[${this.name} worker] ${data}`))
    }
    this.worker.once('exit', (code) => {
      this.exited = true
      if (code !== 0 && code !== null) this.fail(new Error(`${this.name} worker exited with code ${code}`))
    })
  }

  onData(data) {
    try {
      const frame = validateWorkerFrame(parseJsonFrame(data.toString('utf8'), MAX_IPC_FRAME_BYTES))
      this.frames.push(frame)
      if (this.frames.length > MAX_RECORDED_FRAMES) this.frames.shift()
      if (frame.type === 'transport.error' && !frame.recoverable) {
        this.fail(new Error(`${this.name} worker error ${frame.code}: ${frame.message}`))
        return
      }
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(frame)) continue
        this.waiters.delete(waiter)
        waiter.resolve(frame)
      }
    } catch (error) {
      this.fail(new Error(`${this.name} sent an invalid frame: ${error.message}`))
    }
  }

  fail(error) {
    if (this.failure) return
    this.failure = error
    for (const waiter of this.waiters) waiter.reject(error)
    this.waiters.clear()
  }

  waitFor(predicate, label, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.failure) return Promise.reject(this.failure)
    const existing = this.frames.find(predicate)
    if (existing) return Promise.resolve(existing)

    let waiter
    const pending = new Promise((resolve, reject) => {
      waiter = { predicate, resolve, reject }
      this.waiters.add(waiter)
    })
    return withTimeout(pending, timeoutMs, `${this.name} ${label}`).finally(() => this.waiters.delete(waiter))
  }

  write(frame) {
    if (this.failure) throw this.failure
    if (!this.pipe || this.pipe.destroyed) throw new Error(`${this.name} worker pipe is closed`)
    this.pipe.write(Buffer.from(encodeJsonFrame(frame, MAX_IPC_FRAME_BYTES), 'utf8'))
  }

  request(frame, timeoutMs = REQUEST_TIMEOUT_MS) {
    const response = this.waitFor(
      (candidate) => candidate.type === 'transport.response' && candidate.requestId === frame.requestId,
      `response ${frame.requestId}`,
      timeoutMs
    )
    this.write(frame)
    return response
  }

  async closeGracefully() {
    if (!this.worker || this.exited) return
    const requestId = id()
    try {
      const response = await this.request({
        version: PROTOCOL_VERSION,
        type: 'transport.close',
        requestId
      })
      assert.equal(response.requestId, requestId)
      assert.equal(response.ok, true)
    } finally {
      this.forceClose()
    }
    await this.waitForExit()
  }

  async waitForExit() {
    if (this.exited || !this.worker) return
    await withTimeout(
      new Promise((resolve) => this.worker.once('exit', resolve)),
      EXIT_TIMEOUT_MS,
      `${this.name} exit`
    ).catch(() => this.forceClose())
  }

  forceClose() {
    if (this.pipe && !this.pipe.destroyed) this.pipe.destroy()
    if (this.worker && !this.worker.destroyed) this.worker.destroy()
  }
}

async function run() {
  const mode = smokeMode(process.argv.slice(2))
  const timeouts = mode === 'public' ? PUBLIC_TIMEOUTS : LOCAL_TIMEOUTS
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-pear-smoke-'))
  const storageA = path.join(tempRoot, 'peer-a')
  const storageB = path.join(tempRoot, 'peer-b')
  await Promise.all([
    fs.mkdir(storageA, { recursive: true }),
    fs.mkdir(storageB, { recursive: true })
  ])

  const roomCode = `smoke-${crypto.randomBytes(8).toString('hex')}`
  const topicHex = deriveDevelopmentTopic(roomCode)
  const peers = []
  let testnet = null
  let hardTimer
  let cleanupPromise = null

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      for (const peer of peers) peer.forceClose()
      if (testnet) await testnet.destroy().catch(() => {})
      await fs.rm(tempRoot, { recursive: true, force: true })
    })()
    return cleanupPromise
  }

  try {
    hardTimer = setTimeout(() => {
      for (const peer of peers) peer.forceClose()
      const reachabilityHint = mode === 'public'
        ? ' Check UDP bind/egress and public bootstrap reachability; this is not a public hole-punch pass.'
        : ''
      console.error(
        `[smoke:${mode}] FAIL: hard timeout after ${timeouts.hard}ms.${reachabilityHint}`
      )
      const forcedExit = setTimeout(() => process.exit(1), 1_500)
      void cleanup().finally(() => {
        clearTimeout(forcedExit)
        process.exit(1)
      })
    }, timeouts.hard)

    if (mode === 'local') testnet = await createTestnet(3, { host: '127.0.0.1' })
    const bootstrap = testnet ? testnet.bootstrap : null
    console.log(`[smoke:${mode}] ephemeral development room ${roomCode}`)
    if (mode === 'local') console.log(`[smoke:${mode}] bootstrap ${JSON.stringify(bootstrap)}`)

    const peerA = new RuntimePeer({
      name: 'Smoke A', roomCode, storagePath: storageA, topicHex, bootstrap
    })
    peers.push(peerA)
    await peerA.waitFor((frame) => frame.type === 'transport.ready', 'ready', timeouts.discovery)

    // Let A's first announce finish before B performs its initial lookup. Starting
    // both first-time announcers at once can make each miss the other until the
    // normal long Hyperswarm refresh interval.
    const peerB = new RuntimePeer({
      name: 'Smoke B', roomCode, storagePath: storageB, topicHex, bootstrap
    })
    peers.push(peerB)

    await Promise.all([
      peerB.waitFor((frame) => frame.type === 'transport.ready', 'ready', timeouts.discovery),
      peerA.waitFor(
        (frame) => frame.type === 'transport.peers' && frame.count === 1,
        'peer discovery',
        timeouts.discovery
      ),
      peerB.waitFor(
        (frame) => frame.type === 'transport.peers' && frame.count === 1,
        'peer discovery',
        timeouts.discovery
      )
    ])

    const requestId = id()
    const messageId = id()
    const payload = {
      kind: 'text',
      text: 'FullTime real-runtime A to B smoke',
      nonce: crypto.randomBytes(6).toString('hex')
    }
    const localEcho = peerA.waitFor(
      (frame) => frame.type === 'transport.message' && frame.messageId === messageId && frame.from.isSelf,
      'local echo'
    )
    const remoteMessage = peerB.waitFor(
      (frame) => frame.type === 'transport.message' && frame.messageId === messageId && !frame.from.isSelf,
      'remote message'
    )
    const responsePromise = peerA.request({
      version: PROTOCOL_VERSION,
      type: 'transport.send',
      requestId,
      messageId,
      sentAt: Date.now(),
      payload
    })

    const [response, local, remote] = await Promise.all([responsePromise, localEcho, remoteMessage])
    assert.equal(response.requestId, requestId)
    assert.equal(response.ok, true)
    assert.equal(response.messageId, messageId)
    assert.equal(response.queuedTo, 1)
    assert.equal(local.messageId, messageId)
    assert.equal(local.from.displayName, 'Smoke A')
    assert.deepEqual(local.payload, payload)
    assert.equal(remote.messageId, messageId)
    assert.equal(remote.from.displayName, 'Smoke A')
    assert.deepEqual(remote.payload, payload)

    await Promise.all(peers.map((peer) => peer.closeGracefully()))
    console.log(
      `[smoke:${mode}] PASS: two Bare workers discovered, exchanged ${messageId}, and closed`
    )
  } catch (error) {
    if (mode === 'public' && /timed out|SWARM_NETWORK|WORKER_STARTUP/.test(error.message)) {
      throw new Error(
        `Public DHT peers did not connect. Check UDP bind/egress and public bootstrap reachability; ` +
        `this environment cannot be treated as a public hole-punch acceptance result. Cause: ${error.message}`
      )
    }
    throw error
  } finally {
    clearTimeout(hardTimer)
    await cleanup()
  }
}

run().catch((error) => {
  console.error(`[smoke] FAIL: ${error.stack || error.message}`)
  process.exitCode = 1
})
