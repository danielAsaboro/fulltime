'use strict'

const b4a = require('b4a')
const c = require('compact-encoding')
const EventEmitter = require('bare-events')
const Protomux = require('protomux')

const {
  ANSWER_ATTESTATION_PROTOCOL,
  createSignedAnswerSubmission,
  decodeAnswerAcceptedReceiptRecord,
  decodeAnswerAttestationResponse,
  encodeSignedAnswerSubmission,
  verifyAnswerAcceptanceToken
} = require('../lib/answer-attestation.js')
const { AnswerAttestationStore } = require('./answer-attestation-store.js')

const KEY_PATTERN = /^[a-f0-9]{64}$/
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_MAX_IN_FLIGHT = 32

class AttestationRejectedError extends Error {
  constructor (code, message, recoverable) {
    super(message)
    this.name = 'AttestationRejectedError'
    this.code = code
    this.recoverable = recoverable
  }
}

class AnswerAttestorClient extends EventEmitter {
  constructor ({
    store,
    swarm,
    account,
    servicePublicKey,
    receiptFeedKey,
    fixtureFeedKey,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    maxInFlight = DEFAULT_MAX_IN_FLIGHT
  }) {
    super()
    if (!store || typeof store.get !== 'function' || !swarm || typeof swarm.join !== 'function') {
      throw new TypeError('Answer attestor client requires the room manager Corestore and Hyperswarm')
    }
    if (!account || typeof account.requireSession !== 'function') {
      throw new TypeError('Answer attestor client requires the local account store')
    }
    this.pins = {
      servicePublicKey: pinnedKey(servicePublicKey, 'Service public key'),
      receiptFeedKey: pinnedKey(receiptFeedKey, 'Receipt feed key'),
      fixtureFeedKey: pinnedKey(fixtureFeedKey, 'Fixture feed key')
    }
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 250 || requestTimeoutMs > 120_000) {
      throw new TypeError('Answer attestor timeout must be an integer from 250 to 120000 milliseconds')
    }
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 128) {
      throw new TypeError('Answer attestor in-flight limit must be an integer from 1 to 128')
    }
    this.store = store
    this.swarm = swarm
    this.account = account
    this.requestTimeoutMs = requestTimeoutMs
    this.maxInFlight = maxInFlight
    this.receiptCore = null
    this.discovery = null
    this.accepted = new AnswerAttestationStore(store, this.pins)
    this.connections = new Map()
    this.pending = new Map()
    this.requestIdsInFlight = new Set()
    this.channelWaiters = new Set()
    this.activeSubmissions = 0
    this.opened = false
    this.closed = false
    this._onReceiptAppendBound = () => {
      if (!this.closed) this.emit('receipt', { at: Date.now() })
    }
  }

  async open () {
    if (this.opened) return this
    if (this.closed) throw new Error('Answer attestor client is closed')
    this.receiptCore = this.store.get({ key: b4a.from(this.pins.receiptFeedKey, 'hex'), active: true })
    await this.receiptCore.ready()
    if (b4a.toString(this.receiptCore.key, 'hex') !== this.pins.receiptFeedKey) {
      throw new Error('Corestore opened an unexpected answer receipt feed')
    }
    this.receiptCore.on('append', this._onReceiptAppendBound)
    await this.accepted.ready()
    this.discovery = this.swarm.join(this.receiptCore.discoveryKey, { server: false, client: true })
    await this.discovery.flushed()
    this.opened = true
    void this.receiptCore.update({ wait: false }).catch((error) => {
      if (!this.closed) this.emit('receipt-error', error)
    })
    return this
  }

  addConnection (connection, peerInfo = {}) {
    if (this.closed || !this.receiptCore || this.connections.has(connection)) return
    if (hasAnyAdvertisedTopic(peerInfo) && !hasTopic(peerInfo, this.receiptCore.discoveryKey)) return
    const state = {
      connection,
      mux: Protomux.from(connection),
      channel: null,
      requestMessage: null,
      ready: false
    }
    const channel = state.mux.createChannel({
      ...this._descriptor(),
      onopen: () => {
        setTimeout(() => {
          if (channel.closed || this.closed) return
          state.ready = true
          this._wakeChannels()
        }, 0)
      },
      onclose: () => this.removeConnection(connection)
    })
    if (!channel) return
    state.requestMessage = channel.addMessage({ encoding: c.buffer })
    channel.addMessage({
      encoding: c.buffer,
      onmessage: (bytes) => void this._onResponse(state, bytes)
    })
    state.channel = channel
    this.connections.set(connection, state)
    connection.once('close', () => this.removeConnection(connection))
    channel.open()
  }

  removeConnection (connection) {
    const state = this.connections.get(connection)
    if (!state) return
    this.connections.delete(connection)
    state.ready = false
    if (!state.channel.closed) state.channel.close()
    this._failPendingFor(state, new Error('Answer attestor connection closed'))
  }

  async submit (input) {
    this._assertOpen()
    const session = this.account.requireSession()
    if (!this.account.identityKeyPair) throw new Error('Account identity is unavailable')
    const submission = createSignedAnswerSubmission(
      this.account.identityKeyPair,
      session.userId,
      input
    )
    if (this.activeSubmissions >= this.maxInFlight) {
      const error = new Error('Too many answer attestations are in flight')
      error.code = 'TOO_MANY_ATTESTATIONS'
      throw error
    }
    if (this.requestIdsInFlight.has(submission.requestId)) {
      throw new Error(`Answer request ${submission.requestId} is already in flight`)
    }
    this.activeSubmissions++
    this.requestIdsInFlight.add(submission.requestId)
    try {
      const state = await this._waitForChannel()
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(submission.requestId)
          reject(new Error(`Answer attestation request ${submission.requestId} timed out`))
        }, this.requestTimeoutMs)
        timer.unref?.()
        this.pending.set(submission.requestId, { state, submission, resolve, reject, timer })
        try {
          state.requestMessage.send(encodeSignedAnswerSubmission(submission))
        } catch (error) {
          clearTimeout(timer)
          this.pending.delete(submission.requestId)
          reject(error)
        }
      })
    } finally {
      this.activeSubmissions--
      this.requestIdsInFlight.delete(submission.requestId)
    }
  }

  getAcceptedByRequest (requestId) {
    this._assertOpen()
    return this.accepted.getByRequest(requestId)
  }

  getAcceptedByReceiptIndex (index) {
    this._assertOpen()
    return this.accepted.getByReceiptIndex(index)
  }

  /** Read and verify a token from the pinned public receipt Hypercore. */
  async getVerifiedReceipt (index, { wait = false } = {}) {
    this._assertOpen()
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Answer receipt index is invalid')
    let block
    try {
      block = await this.receiptCore.get(index, wait
        ? { wait: true, timeout: this.requestTimeoutMs }
        : { wait: false })
    } catch (cause) {
      const error = new Error('The pinned answer receipt feed could not be read')
      error.code = 'RECEIPT_FEED_UNAVAILABLE'
      error.cause = cause
      throw error
    }
    if (!block) {
      void this.receiptCore.update({ wait: false }).catch((error) => {
        if (!this.closed) this.emit('receipt-error', error)
      })
      const error = new Error('This accepted answer has not replicated from the pinned receipt feed yet')
      error.code = 'RECEIPT_NOT_REPLICATED'
      error.recoverable = true
      throw error
    }
    try {
      const receipt = decodeAnswerAcceptedReceiptRecord(block)
      const token = verifyAnswerAcceptanceToken(receipt.token, this.pins)
      if (token.claims.receiptIndex !== index) {
        throw new Error('Pinned answer receipt index does not match its signed token')
      }
      return token
    } catch (cause) {
      const error = new Error('The pinned answer receipt is invalid')
      error.code = 'RECEIPT_INVALID'
      error.cause = cause
      throw error
    }
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.opened = false
    const closeError = new Error('Answer attestor client closed')
    for (const waiter of this.channelWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(closeError)
    }
    this.channelWaiters.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(closeError)
    }
    this.pending.clear()
    this.requestIdsInFlight.clear()
    for (const state of this.connections.values()) {
      if (!state.channel.closed) state.channel.close()
    }
    this.receiptCore?.removeListener('append', this._onReceiptAppendBound)
    this.connections.clear()
    await this.discovery?.destroy().catch(() => {})
    await this.receiptCore?.close().catch(() => {})
    await this.accepted.close().catch(() => {})
    this.discovery = null
    this.receiptCore = null
  }

  async _onResponse (state, bytes) {
    let response
    try {
      response = decodeAnswerAttestationResponse(bytes)
    } catch (error) {
      this._failPendingFor(state, error)
      if (!state.channel.closed) state.channel.close()
      return
    }
    if (response.requestId === null) {
      this._failPendingFor(state, new AttestationRejectedError(
        response.error.code,
        response.error.message,
        response.error.recoverable
      ))
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending || pending.state !== state) return
    clearTimeout(pending.timer)
    this.pending.delete(response.requestId)
    if (!response.ok) {
      pending.reject(new AttestationRejectedError(
        response.error.code,
        response.error.message,
        response.error.recoverable
      ))
      return
    }
    try {
      const token = verifyAnswerAcceptanceToken(response.token, this.pins)
      if (JSON.stringify(token.claims.submission) !== JSON.stringify(pending.submission)) {
        throw new Error('Acceptance token does not bind the submitted answer')
      }
      const receiptBlock = await this.receiptCore.get(token.claims.receiptIndex, {
        wait: true,
        timeout: this.requestTimeoutMs
      })
      if (!receiptBlock) throw new Error('Accepted answer is missing from the pinned receipt feed')
      const receipt = decodeAnswerAcceptedReceiptRecord(receiptBlock)
      const receiptToken = verifyAnswerAcceptanceToken(receipt.token, this.pins)
      if (JSON.stringify(receiptToken) !== JSON.stringify(token)) {
        throw new Error('Acceptance response does not match its durable receipt block')
      }
      await this.accepted.persist(token)
      this.emit('receipt', { index: token.claims.receiptIndex, at: Date.now() })
      pending.resolve(token)
    } catch (error) {
      pending.reject(error)
    }
  }

  _waitForChannel () {
    const ready = this._readyConnection()
    if (ready) return Promise.resolve(ready)
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        this.channelWaiters.delete(waiter)
        reject(new Error('Could not connect to the pinned answer-attestor service'))
      }, this.requestTimeoutMs)
      waiter.timer.unref?.()
      this.channelWaiters.add(waiter)
    })
  }

  _wakeChannels () {
    const ready = this._readyConnection()
    if (!ready) return
    for (const waiter of this.channelWaiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(ready)
    }
    this.channelWaiters.clear()
  }

  _readyConnection () {
    for (const state of this.connections.values()) {
      if (state.ready && state.channel.opened && !state.channel.closed) return state
    }
    return null
  }

  _failPendingFor (state, error) {
    for (const [requestId, pending] of this.pending) {
      if (pending.state !== state) continue
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.reject(error)
    }
  }

  _descriptor () {
    return {
      protocol: ANSWER_ATTESTATION_PROTOCOL,
      id: b4a.from(this.pins.servicePublicKey, 'hex')
    }
  }

  _assertOpen () {
    if (!this.opened || this.closed || !this.receiptCore) {
      throw new Error('Answer attestor client is not open')
    }
  }
}

function pinnedKey (value, label) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new TypeError(`${label} must be 32-byte lowercase hex`)
  }
  return value
}

function hasTopic (peerInfo, topic) {
  if (!hasAdvertisedTopics(peerInfo)) return false
  for (const candidate of peerInfo.topics) {
    if (b4a.isBuffer(candidate) && b4a.equals(candidate, topic)) return true
  }
  return false
}

function hasAdvertisedTopics (peerInfo) {
  return Boolean(peerInfo?.topics && typeof peerInfo.topics[Symbol.iterator] === 'function')
}

function hasAnyAdvertisedTopic (peerInfo) {
  if (!hasAdvertisedTopics(peerInfo)) return false
  for (const _topic of peerInfo.topics) return true
  return false
}

module.exports = {
  AttestationRejectedError,
  AnswerAttestorClient,
  DEFAULT_MAX_IN_FLIGHT,
  DEFAULT_REQUEST_TIMEOUT_MS
}
