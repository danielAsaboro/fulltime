'use strict'

const Hyperbee = require('hyperbee')

const { verifyAnswerAcceptanceToken } = require('../lib/answer-attestation.js')

const LOCAL_ATTESTATION_VERSION = 1

class AnswerAttestationStore {
  constructor (rootStore, pins) {
    if (!rootStore || typeof rootStore.namespace !== 'function') {
      throw new TypeError('Answer attestation store requires an open Corestore')
    }
    this.pins = pins
    this.store = rootStore.namespace('fulltime-local-answer-attestations-v1')
    this.db = new Hyperbee(this.store.get({ name: 'accepted' }), {
      extension: false,
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    this.opened = false
    this.closed = false
  }

  async ready () {
    if (this.opened) return
    if (this.closed) throw new Error('Answer attestation store is closed')
    await this.db.ready()
    this.opened = true
  }

  async persist (value) {
    this._assertOpen()
    const token = verifyAnswerAcceptanceToken(value, this.pins)
    const requestKey = `request/${token.claims.submission.requestId}`
    const receiptKey = receiptStorageKey(token)
    const [byRequest, byReceipt] = await Promise.all([
      this.db.get(requestKey),
      this.db.get(receiptKey)
    ])
    assertSameToken(byRequest, token, 'request ID')
    assertSameToken(byReceipt, token, 'receipt index')
    if (byRequest && byReceipt) return token

    const record = {
      version: LOCAL_ATTESTATION_VERSION,
      token,
      storedAt: Date.now()
    }
    const batch = this.db.batch()
    if (!byRequest) await batch.put(requestKey, record)
    if (!byReceipt) await batch.put(receiptKey, record)
    await batch.flush()
    return token
  }

  async getByRequest (requestId) {
    this._assertOpen()
    validateLookupId(requestId, 'Request ID')
    const entry = await this.db.get(`request/${requestId}`)
    return this._read(entry)
  }

  async getByReceiptIndex (index) {
    this._assertOpen()
    if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Receipt index is invalid')
    const entry = await this.db.get(`receipt/${this.pins.receiptFeedKey}/${index}`)
    return this._read(entry)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.opened = false
    await this.db.close().catch(() => {})
    await this.store.close().catch(() => {})
  }

  _read (entry) {
    if (!entry) return null
    const record = validateStoredRecord(entry.value)
    return verifyAnswerAcceptanceToken(record.token, this.pins)
  }

  _assertOpen () {
    if (!this.opened || this.closed) throw new Error('Answer attestation store is not open')
  }
}

function receiptStorageKey (token) {
  return `receipt/${token.claims.receiptFeedKey}/${token.claims.receiptIndex}`
}

function validateLookupId (value, label) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}._:/-]{7,127}$/u.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
}

function assertSameToken (entry, candidate, keyType) {
  if (!entry) return
  let record
  try {
    record = validateStoredRecord(entry.value)
  } catch {
    throw new Error(`The local answer attestation ${keyType} record is corrupted`)
  }
  if (JSON.stringify(record.token) !== JSON.stringify(candidate)) {
    throw new Error(`A different accepted token already owns this ${keyType}`)
  }
}

function validateStoredRecord (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== 3 ||
      !Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'token') || !Object.hasOwn(value, 'storedAt') ||
      value.version !== LOCAL_ATTESTATION_VERSION ||
      !Number.isSafeInteger(value.storedAt) || value.storedAt < 0) {
    throw new Error('The local answer attestation record is corrupted')
  }
  return value
}

module.exports = { AnswerAttestationStore, LOCAL_ATTESTATION_VERSION }
