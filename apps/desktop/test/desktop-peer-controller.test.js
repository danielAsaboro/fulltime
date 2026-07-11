'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const b4a = require('b4a')

const { DesktopPeerController } = require('../lib/desktop-peer-controller.js')
const { signNetworkManifest } = require('../lib/network-manifest.js')

class FakeWorker extends EventEmitter {
  constructor () {
    super()
    this.stderr = new EventEmitter()
    this.destroyed = false
  }

  destroy () {
    this.destroyed = true
    this.emit('exit', 0)
  }
}

class FakeFramedStream extends EventEmitter {
  constructor (worker) {
    super()
    this.worker = worker
    this.destroyed = false
    this.bootstrapped = false
  }

  write (value, callback) {
    const frame = JSON.parse(Buffer.from(value).toString('utf8'))
    if (!this.bootstrapped) {
      this.bootstrapped = true
      queueMicrotask(() => this.emit('data', Buffer.from(JSON.stringify({ version: 2, type: 'bridge.ready', mode: 'pear-p2p-rooms', at: Date.now() }))))
    } else if (frame.action === 'system.close') {
      queueMicrotask(() => this.emit('data', Buffer.from(JSON.stringify({ version: 2, id: frame.id, ok: true, result: null }))))
    } else {
      queueMicrotask(() => this.emit('data', Buffer.from(JSON.stringify({ version: 2, id: frame.id, ok: true, result: { action: frame.action } }))))
    }
    callback?.()
    return true
  }

  destroy () {
    this.destroyed = true
  }
}

class DelayedReadyFramedStream extends FakeFramedStream {
  write (value, callback) {
    if (!this.bootstrapped) {
      this.bootstrapped = true
      setTimeout(() => this.emit('data', Buffer.from(JSON.stringify({ version: 2, type: 'bridge.ready', mode: 'pear-p2p-rooms', at: Date.now() }))), 25)
      callback?.()
      return true
    }
    return super.write(value, callback)
  }
}

function signedResolution () {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return {
    publicKey,
    resolution: {
      source: 'network',
      stale: false,
      manifest: signNetworkManifest({
        version: 1,
        issuedAt: Date.now(),
        fixtureFeedKey: 'ab'.repeat(32),
        answerAttestor: { servicePublicKey: 'cd'.repeat(32), receiptFeedKey: 'ef'.repeat(32) }
      }, privateKey)
    }
  }
}

test('DesktopPeerController owns one worker and carries only manifest-derived public pins into it', async () => {
  const runs = []
  const runtime = {
    run (workerPath, args) {
      const worker = new FakeWorker()
      runs.push({ workerPath, args, worker })
      return worker
    }
  }
  const signed = signedResolution()
  const controller = new DesktopPeerController({
    storagePath: '/tmp/fulltime-controller-test',
    displayName: 'Amina',
    workerPath: '/fake/rooms.js',
    pearRuntime: runtime,
    FramedStreamConstructor: FakeFramedStream,
    manifestPublicKey: signed.publicKey
  })
  await controller.start({ deviceSecret: b4a.from('11'.repeat(32), 'hex'), networkResolution: signed.resolution })
  await controller.waitUntilReady()

  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].args, [
    '--storage', '/tmp/fulltime-controller-test',
    '--name', 'Amina',
    '--fixture-feed-key', 'ab'.repeat(32),
    '--answer-attestor-public-key', 'cd'.repeat(32),
    '--answer-receipt-feed-key', 'ef'.repeat(32)
  ])
  const response = await controller.request({ version: 2, id: 'request-123', action: 'fixture.list', payload: {} })
  assert.deepEqual(response, { version: 2, id: 'request-123', ok: true, result: { action: 'fixture.list' } })
  await controller.close()
  assert.equal(runs[0].worker.destroyed, true)
})

test('DesktopPeerController holds renderer requests until the real worker is ready', async () => {
  const signed = signedResolution()
  const controller = new DesktopPeerController({
    storagePath: '/tmp/fulltime-controller-delayed-ready',
    displayName: 'Amina',
    workerPath: '/fake/rooms.js',
    pearRuntime: { run: () => new FakeWorker() },
    FramedStreamConstructor: DelayedReadyFramedStream,
    manifestPublicKey: signed.publicKey,
    requestTimeoutMs: 1_000
  })
  await controller.start({ deviceSecret: b4a.from('33'.repeat(32), 'hex'), networkResolution: signed.resolution })

  const response = await controller.request({ version: 2, id: 'early-request', action: 'session.get', payload: null })
  assert.deepEqual(response, { version: 2, id: 'early-request', ok: true, result: { action: 'session.get' } })
  await controller.close()
})

test('DesktopPeerController will not launch a worker when signed network configuration is unavailable', () => {
  let runs = 0
  const controller = new DesktopPeerController({
    storagePath: '/tmp/fulltime-controller-unavailable',
    displayName: 'Amina',
    pearRuntime: { run () { runs++ } },
    FramedStreamConstructor: FakeFramedStream
  })
  controller.setUnavailable(new Error('No verified manifest'))
  assert.throws(() => controller.bridgeConfig(), (error) => error.code === 'CONFIGURATION_UNAVAILABLE')
  assert.equal(runs, 0)
})

test('DesktopPeerController independently rejects a manifest that does not match its embedded trust root', async () => {
  const signed = signedResolution()
  const { publicKey: wrongPublicKey } = crypto.generateKeyPairSync('ed25519')
  let runs = 0
  const controller = new DesktopPeerController({
    storagePath: '/tmp/fulltime-controller-wrong-root',
    displayName: 'Amina',
    pearRuntime: { run () { runs++ } },
    FramedStreamConstructor: FakeFramedStream,
    manifestPublicKey: wrongPublicKey
  })
  await assert.rejects(
    controller.start({ deviceSecret: b4a.from('22'.repeat(32), 'hex'), networkResolution: signed.resolution }),
    /did not verify/
  )
  assert.equal(runs, 0)
})
