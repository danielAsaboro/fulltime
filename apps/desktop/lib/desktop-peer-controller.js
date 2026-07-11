'use strict'

const crypto = require('crypto')
const { EventEmitter } = require('events')

const b4a = require('b4a')
const FramedStream = require('framed-stream')
const PearRuntime = require('pear-runtime')

const { normalizeDisplayName, normalizeFixtureFeedKey, normalizeStoragePath } = require('./config.js')
const { verifyNetworkManifest } = require('./network-manifest.js')
const {
  ROOM_IPC_VERSION,
  encodeRoomFrame,
  parseRoomFrame,
  validateEvent,
  validateRequest,
  validateResponse
} = require('./room-protocol.js')
const { encodeWorkerBootstrap } = require('./worker-bootstrap.js')

const REQUEST_TIMEOUT_MS = 60_000
const MAX_PENDING_REQUESTS = 128
const MAX_EVENT_BACKLOG = 100

class DesktopPeerControllerError extends Error {
  constructor (code, message, options = undefined) {
    super(message, options)
    this.name = 'DesktopPeerControllerError'
    this.code = code
  }
}

/**
 * Owns exactly one Pear Runtime room worker for a desktop process.  Electron
 * preload IPC and localhost browser requests both pass through this controller;
 * neither path is allowed to create a second identity, Corestore, or room host.
 */
class DesktopPeerController extends EventEmitter {
  constructor ({
    storagePath,
    displayName,
    workerPath = require.resolve('../workers/rooms.js'),
    pearRuntime = PearRuntime,
    FramedStreamConstructor = FramedStream,
    manifestPublicKey = null,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    maxPendingRequests = MAX_PENDING_REQUESTS
  }) {
    super()
    this.storagePath = normalizeStoragePath(storagePath)
    this.displayName = normalizeDisplayName(displayName)
    if (typeof workerPath !== 'string' || !workerPath) throw new TypeError('Room worker path is required')
    if (!pearRuntime || typeof pearRuntime.run !== 'function') throw new TypeError('Pear Runtime runner is required')
    if (typeof FramedStreamConstructor !== 'function') throw new TypeError('Framed stream constructor is required')
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) {
      throw new TypeError('Peer request timeout must be 1000-120000 milliseconds')
    }
    if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1 || maxPendingRequests > 1_024) {
      throw new TypeError('Maximum pending peer requests must be 1-1024')
    }
    this.workerPath = workerPath
    this.pearRuntime = pearRuntime
    this.FramedStreamConstructor = FramedStreamConstructor
    this.requestTimeoutMs = requestTimeoutMs
    this.maxPendingRequests = maxPendingRequests
    this.workerHandle = null
    this.workerPipe = null
    this.pendingRequests = new Map()
    this.cachedEvents = new Map()
    this.eventBacklog = []
    this.networkResolution = null
    this.unavailable = null
    this.started = false
    this.closing = false
    this.closePromise = null
    this.readyPromise = null
    this.ready = false
    this.resolveReady = null
    this.rejectReady = null
    this.failure = null
    this.manifestPublicKey = null
    if (manifestPublicKey) this.setManifestVerificationKey(manifestPublicKey)
  }

  get isAvailable () {
    return !this.unavailable && !this.failure && this.started && this.ready && Boolean(this.workerPipe) && !this.closing
  }

  get isStarting () {
    return !this.unavailable && !this.failure && this.started && !this.closing
  }

  setUnavailable (error) {
    if (this.started) throw new Error('Cannot make an active peer controller unavailable')
    const message = error instanceof Error && error.message
      ? error.message
      : 'FullTime network configuration is unavailable.'
    this.unavailable = new DesktopPeerControllerError('CONFIGURATION_UNAVAILABLE', message, { cause: error })
    this.emit('availability', this.availability())
  }

  setManifestVerificationKey (publicKey) {
    if (this.started) throw new Error('Cannot change manifest verification key after peer startup')
    if (!publicKey) throw new TypeError('Manifest verification public key is required')
    this.manifestPublicKey = publicKey
  }

  availability () {
    if (this.unavailable) {
      return { state: 'unavailable', code: this.unavailable.code, message: this.unavailable.message }
    }
    if (!this.started) return { state: 'unavailable', code: 'CONFIGURATION_UNAVAILABLE', message: 'FullTime network configuration is unavailable.' }
    return {
      state: this.failure ? 'failed' : (this.ready ? 'ready' : 'starting'),
      stale: Boolean(this.networkResolution?.stale),
      issuedAt: this.networkResolution?.manifest?.issuedAt ?? null
    }
  }

  bridgeConfig () {
    if (this.unavailable || !this.started) throw this.unavailableError()
    const config = {
      protocolVersion: ROOM_IPC_VERSION,
      mode: 'pear-p2p-rooms',
      maxRoomMembers: 256
    }
    if (this.networkResolution?.stale) config.networkConfig = 'stale'
    return config
  }

  cachedState () {
    return [...this.cachedEvents.values()]
  }

  replayEvents () {
    return [...this.eventBacklog]
  }

  async start ({ deviceSecret, networkResolution, bootstrap = undefined }) {
    if (this.started) throw new Error('Desktop peer controller is already started')
    if (this.closing) throw new Error('Desktop peer controller is closing')
    if (!networkResolution || typeof networkResolution !== 'object' || !networkResolution.manifest) {
      throw new TypeError('A verified network manifest resolution is required before starting peers')
    }
    if (!b4a.isBuffer(deviceSecret) || deviceSecret.byteLength !== 32) {
      throw new TypeError('Desktop peer controller requires a 32-byte device secret')
    }
    if (!this.manifestPublicKey) {
      throw new DesktopPeerControllerError('CONFIGURATION_UNAVAILABLE', 'A manifest verification public key is required before starting peers')
    }
    const manifest = verifyNetworkManifest(networkResolution.manifest, this.manifestPublicKey)
    const pins = { fixtureFeedKey: manifest.fixtureFeedKey, ...(manifest.answerAttestor ? { answerAttestor: manifest.answerAttestor } : {}) }
    const args = [
      '--storage', this.storagePath,
      '--name', this.displayName,
      '--fixture-feed-key', normalizeFixtureFeedKey(pins.fixtureFeedKey)
    ]
    if (pins.answerAttestor) {
      args.push(
        '--answer-attestor-public-key', normalizeFixtureFeedKey(pins.answerAttestor.servicePublicKey),
        '--answer-receipt-feed-key', normalizeFixtureFeedKey(pins.answerAttestor.receiptFeedKey)
      )
    }
    if (bootstrap !== undefined) args.push('--bootstrap', JSON.stringify(bootstrap))

    this.networkResolution = {
      manifest,
      source: networkResolution.source === 'cache' ? 'cache' : 'network',
      stale: Boolean(networkResolution.stale)
    }
    this.started = true
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Waiting for ready is optional for the UI. Keep a failed worker from
    // becoming an unhandled-rejection process failure when nobody waits.
    this.readyPromise.catch(() => {})

    let bootstrapFrame = null
    try {
      const worker = this.pearRuntime.run(this.workerPath, args)
      this.workerHandle = worker
      const pipe = new this.FramedStreamConstructor(worker, { bits: 24 })
      this.workerPipe = pipe
      pipe.on('data', (data) => this._handleWorkerFrame(data))
      pipe.on('error', (error) => this._failWorker(error, 'WORKER_STREAM'))
      if (worker.stderr && typeof worker.stderr.on === 'function') {
        worker.stderr.on('data', (data) => process.stderr.write(`[fulltime peer worker] ${data}`))
      }
      if (typeof worker.once === 'function') {
        worker.once('exit', (code) => this._handleWorkerExit(code))
      }
      bootstrapFrame = Buffer.from(encodeWorkerBootstrap(deviceSecret))
      const frameToWrite = bootstrapFrame
      pipe.write(frameToWrite, () => frameToWrite.fill(0))
      bootstrapFrame = null
      this.emit('availability', this.availability())
    } catch (error) {
      bootstrapFrame?.fill(0)
      this._failWorker(error, 'WORKER_STARTUP')
      throw error
    }
  }

  waitUntilReady () {
    if (this.unavailable || !this.started) return Promise.reject(this.unavailableError())
    return this.readyPromise || Promise.resolve()
  }

  request (command) {
    const frame = validateRequest(command)
    if (this.unavailable || !this.started) return Promise.reject(this.unavailableError())
    return this._requestWhenReady(frame)
  }

  async _requestWhenReady (frame) {
    if (!this.ready) {
      try {
        await Promise.race([
          this.waitUntilReady(),
          timeoutAfter(this.requestTimeoutMs, `The peer worker did not become ready for ${frame.action}`)
        ])
      } catch (error) {
        if (error instanceof DesktopPeerControllerError) throw error
        throw new DesktopPeerControllerError('REQUEST_TIMEOUT', `The peer worker request ${frame.action} timed out`, { cause: error })
      }
    }
    if (this.failure || this.closing || !this.workerPipe || this.workerPipe.destroyed) {
      return Promise.reject(new DesktopPeerControllerError('WORKER_UNAVAILABLE', 'The local FullTime peer worker is unavailable'))
    }
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      return Promise.reject(new DesktopPeerControllerError('TOO_MANY_REQUESTS', 'Too many peer worker requests are active'))
    }
    if (this.pendingRequests.has(frame.id)) {
      return Promise.reject(new DesktopPeerControllerError('DUPLICATE_REQUEST', 'A peer worker request with this ID is already active'))
    }
    return this._writeRequest(frame)
  }

  async close () {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.closePromise = this._close()
    return this.closePromise
  }

  async _close () {
    const pipe = this.workerPipe
    const worker = this.workerHandle
    try {
      if (pipe && !pipe.destroyed && !this.unavailable) {
        const id = crypto.randomUUID()
        await Promise.race([
          this._writeRequest({ version: ROOM_IPC_VERSION, id, action: 'system.close', payload: null }, true),
          timeoutAfter(8_000, 'Peer worker shutdown timed out')
        ])
      }
    } catch {
      // The forced teardown below is the safe fallback when a Bare worker has already failed.
    } finally {
      this._rejectPending(new DesktopPeerControllerError('WORKER_UNAVAILABLE', 'The local FullTime peer worker is closing'))
      try {
        pipe?.destroy()
      } catch {}
      try {
        worker?.destroy()
      } catch {}
      this.workerPipe = null
      this.workerHandle = null
      this._rejectReady(new DesktopPeerControllerError('WORKER_UNAVAILABLE', 'The local FullTime peer worker closed before becoming ready'))
      this.emit('availability', this.availability())
      this.removeAllListeners()
    }
  }

  _writeRequest (frame, allowClosing = false) {
    if ((!allowClosing && this.closing) || !this.workerPipe || this.workerPipe.destroyed) {
      return Promise.reject(new DesktopPeerControllerError('WORKER_UNAVAILABLE', 'The local FullTime peer worker is unavailable'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(frame.id)
        reject(new DesktopPeerControllerError('REQUEST_TIMEOUT', `The peer worker request ${frame.action} timed out`))
      }, this.requestTimeoutMs)
      timer.unref?.()
      this.pendingRequests.set(frame.id, { resolve, reject, timer })
      try {
        this.workerPipe.write(Buffer.from(encodeRoomFrame(frame), 'utf8'))
      } catch (error) {
        clearTimeout(timer)
        this.pendingRequests.delete(frame.id)
        reject(error)
      }
    })
  }

  _handleWorkerFrame (data) {
    try {
      const parsed = parseRoomFrame(data)
      if (Object.hasOwn(parsed, 'ok')) {
        const frame = validateResponse(parsed)
        const pending = this.pendingRequests.get(frame.id)
        if (!pending) return
        this.pendingRequests.delete(frame.id)
        clearTimeout(pending.timer)
        pending.resolve(frame)
        return
      }
      const event = validateEvent(parsed)
      if (event.type === 'bridge.ready') this._resolveReady()
      if (event.type === 'notification.queued') {
        this.emit('notification', event.intent)
        return
      }
      this._rememberEvent(event)
      this.emit('event', event)
    } catch (error) {
      this._failWorker(error, 'WORKER_PROTOCOL')
    }
  }

  _rememberEvent (event) {
    if (event.type === 'bridge.ready' || event.type === 'transport.status') this.cachedEvents.set(event.type, event)
    if (event.type === 'fixture.updated') this.cachedEvents.set(`${event.type}:${event.fixtureId}`, event)
    if (event.type === 'room.state' || event.type === 'room.details') this.cachedEvents.set(`${event.type}:${event.roomId}`, event)
    this.eventBacklog.push(event)
    if (this.eventBacklog.length > MAX_EVENT_BACKLOG) this.eventBacklog.shift()
  }

  _handleWorkerExit (code) {
    if (this.closing) return
    this._failWorker(
      new DesktopPeerControllerError('WORKER_EXITED', `The local peer worker exited (${code ?? 'unknown'})`),
      'WORKER_EXITED'
    )
  }

  _failWorker (error, code) {
    if (this.closing && code !== 'WORKER_PROTOCOL') return
    if (this.failure) return
    const failure = error instanceof DesktopPeerControllerError
      ? error
      : new DesktopPeerControllerError(code, 'The local FullTime peer worker failed.', { cause: error })
    this.failure = failure
    this._rejectPending(failure)
    this._rejectReady(failure)
    const event = {
      version: ROOM_IPC_VERSION,
      type: 'room.error',
      code: failure.code || code,
      message: failure.message,
      recoverable: false,
      at: Date.now()
    }
    this._rememberEvent(event)
    this.emit('event', event)
  }

  _resolveReady () {
    if (!this.resolveReady) return
    this.ready = true
    this.resolveReady()
    this.resolveReady = null
    this.rejectReady = null
    this.emit('availability', this.availability())
  }

  _rejectReady (error) {
    if (!this.rejectReady) return
    this.rejectReady(error)
    this.resolveReady = null
    this.rejectReady = null
  }

  _rejectPending (error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  unavailableError () {
    return this.unavailable || new DesktopPeerControllerError(
      'CONFIGURATION_UNAVAILABLE',
      'FullTime network configuration is unavailable. Connect to refresh signed configuration and restart FullTime.'
    )
  }
}

function timeoutAfter (milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    timer.unref?.()
  })
}

module.exports = {
  DesktopPeerController,
  DesktopPeerControllerError,
  MAX_EVENT_BACKLOG,
  MAX_PENDING_REQUESTS,
  REQUEST_TIMEOUT_MS
}
