'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-universal')

const { keyAgreementKeyId, openMemberSeal, sealToMember } = require('./member-crypto.js')

const REPORT_VERSION = 1
const REPORT_REASONS = new Set([
  'harassment',
  'hate',
  'misinformation',
  'sexual-content',
  'spam',
  'threats',
  'other'
])
const IDENTIFIER = /^[a-zA-Z0-9._:-]{3,180}$/
const HEX_16 = /^[a-f0-9]{32}$/
const HEX_24 = /^[a-f0-9]{48}$/
const HEX_32 = /^[a-f0-9]{64}$/
const MAX_REPORT_NOTE_LENGTH = 1000
const MAX_REPORT_RECIPIENTS = 256

function createEncryptedReport ({ roomId, reportId, reporterId, target, reason, note = '', createdAt, recipients }) {
  const report = validateReportPlaintext({
    version: REPORT_VERSION,
    roomId,
    reportId,
    reporterId,
    target,
    reason,
    note,
    createdAt
  })
  const normalizedRecipients = validateRecipients(recipients)
  const key = crypto.randomBytes(sodium.crypto_secretbox_KEYBYTES)
  const nonce = crypto.randomBytes(sodium.crypto_secretbox_NONCEBYTES)
  const plaintext = b4a.from(JSON.stringify(report))
  const ciphertext = b4a.alloc(plaintext.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, key)
  const keyWraps = normalizedRecipients.map((recipient) => ({
    userId: recipient.userId,
    keyId: keyAgreementKeyId(recipient.publicKey),
    sealedKey: b4a.toString(sealToMember(key, recipient.publicKey), 'hex')
  }))
  key.fill(0)
  plaintext.fill(0)
  return validateEncryptedReportEnvelope({
    version: REPORT_VERSION,
    reportId: report.reportId,
    algorithm: 'xsalsa20-poly1305-v1',
    nonce: b4a.toString(nonce, 'hex'),
    ciphertext: b4a.toString(ciphertext, 'hex'),
    keyWraps
  })
}

function openEncryptedReport (envelopeValue, { userId, keyPair }) {
  const envelope = validateEncryptedReportEnvelope(envelopeValue)
  identifier(userId, 'Report recipient')
  const keyId = keyAgreementKeyId(keyPair.publicKey)
  const wrap = envelope.keyWraps.find((candidate) => candidate.userId === userId && candidate.keyId === keyId)
  if (!wrap) throw new Error('This moderation report is not addressed to the current member key')
  const key = openMemberSeal(b4a.from(wrap.sealedKey, 'hex'), keyPair)
  const ciphertext = b4a.from(envelope.ciphertext, 'hex')
  const plaintext = b4a.alloc(ciphertext.byteLength - sodium.crypto_secretbox_MACBYTES)
  const opened = sodium.crypto_secretbox_open_easy(
    plaintext,
    ciphertext,
    b4a.from(envelope.nonce, 'hex'),
    key
  )
  key.fill(0)
  if (!opened) {
    plaintext.fill(0)
    throw new Error('Moderation report ciphertext was modified')
  }
  let decoded
  try {
    decoded = JSON.parse(b4a.toString(plaintext))
  } catch {
    throw new Error('Moderation report plaintext is invalid')
  } finally {
    plaintext.fill(0)
  }
  const report = validateReportPlaintext(decoded)
  if (report.reportId !== envelope.reportId) throw new Error('Moderation report ID does not match its envelope')
  return report
}

function validateEncryptedReportEnvelope (value) {
  plainObject(value, 'Moderation report envelope')
  exactKeys(value, ['version', 'reportId', 'algorithm', 'nonce', 'ciphertext', 'keyWraps'], 'Moderation report envelope')
  if (value.version !== REPORT_VERSION) throw new TypeError('Moderation report version is unsupported')
  const reportId = identifier(value.reportId, 'Moderation report ID')
  if (value.algorithm !== 'xsalsa20-poly1305-v1') throw new TypeError('Moderation report algorithm is unsupported')
  const nonce = hex(value.nonce, HEX_24, 'Moderation report nonce')
  if (typeof value.ciphertext !== 'string' || !/^[a-f0-9]+$/.test(value.ciphertext) ||
      value.ciphertext.length % 2 !== 0 || value.ciphertext.length < sodium.crypto_secretbox_MACBYTES * 2 ||
      value.ciphertext.length > (4096 + sodium.crypto_secretbox_MACBYTES) * 2) {
    throw new TypeError('Moderation report ciphertext is invalid')
  }
  if (!Array.isArray(value.keyWraps) || value.keyWraps.length < 1 || value.keyWraps.length > MAX_REPORT_RECIPIENTS) {
    throw new TypeError('Moderation report recipients are invalid')
  }
  const seen = new Set()
  const keyWraps = value.keyWraps.map((candidate) => {
    plainObject(candidate, 'Moderation report key wrap')
    exactKeys(candidate, ['userId', 'keyId', 'sealedKey'], 'Moderation report key wrap')
    const userId = identifier(candidate.userId, 'Moderation report recipient')
    const keyId = hex(candidate.keyId, HEX_32, 'Moderation report recipient key ID')
    const sealedKey = hex(candidate.sealedKey, null, 'Moderation report sealed key')
    if (sealedKey.length !== (sodium.crypto_secretbox_KEYBYTES + sodium.crypto_box_SEALBYTES) * 2) {
      throw new TypeError('Moderation report sealed key has an invalid size')
    }
    const identity = `${userId}:${keyId}`
    if (seen.has(identity)) throw new TypeError('Moderation report recipients must be unique')
    seen.add(identity)
    return { userId, keyId, sealedKey }
  })
  const sorted = [...keyWraps].sort(compareWraps)
  if (JSON.stringify(keyWraps) !== JSON.stringify(sorted)) {
    throw new TypeError('Moderation report recipients must be canonically ordered')
  }
  return {
    version: REPORT_VERSION,
    reportId,
    algorithm: 'xsalsa20-poly1305-v1',
    nonce,
    ciphertext: value.ciphertext,
    keyWraps
  }
}

function validateReportPlaintext (value) {
  plainObject(value, 'Moderation report')
  exactKeys(value, ['version', 'roomId', 'reportId', 'reporterId', 'target', 'reason', 'note', 'createdAt'], 'Moderation report')
  if (value.version !== REPORT_VERSION) throw new TypeError('Moderation report version is unsupported')
  const roomId = identifier(value.roomId, 'Moderation report room')
  const reportId = identifier(value.reportId, 'Moderation report ID')
  const reporterId = identifier(value.reporterId, 'Moderation report author')
  plainObject(value.target, 'Moderation report target')
  exactKeys(value.target, ['kind', 'id'], 'Moderation report target')
  if (value.target.kind !== 'item' && value.target.kind !== 'member') {
    throw new TypeError('Moderation report target kind is unsupported')
  }
  const target = { kind: value.target.kind, id: identifier(value.target.id, 'Moderation report target ID') }
  if (typeof value.reason !== 'string' || !REPORT_REASONS.has(value.reason)) {
    throw new TypeError('Moderation report reason is unsupported')
  }
  if (typeof value.note !== 'string' || value.note.normalize('NFC') !== value.note ||
      value.note.length > MAX_REPORT_NOTE_LENGTH || /[\u0000\u007f]/.test(value.note)) {
    throw new TypeError(`Moderation report note may not exceed ${MAX_REPORT_NOTE_LENGTH} characters`)
  }
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw new TypeError('Moderation report timestamp is invalid')
  }
  return {
    version: REPORT_VERSION,
    roomId,
    reportId,
    reporterId,
    target,
    reason: value.reason,
    note: value.note,
    createdAt: value.createdAt
  }
}

function validateRecipients (value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPORT_RECIPIENTS) {
    throw new TypeError('Moderation report recipients are invalid')
  }
  const seen = new Set()
  const recipients = value.map((recipient) => {
    plainObject(recipient, 'Moderation report recipient')
    exactKeys(recipient, ['userId', 'publicKey'], 'Moderation report recipient')
    const userId = identifier(recipient.userId, 'Moderation report recipient')
    if (!b4a.isBuffer(recipient.publicKey) || recipient.publicKey.byteLength !== sodium.crypto_box_PUBLICKEYBYTES) {
      throw new TypeError('Moderation report recipient public key is invalid')
    }
    const keyId = keyAgreementKeyId(recipient.publicKey)
    const identity = `${userId}:${keyId}`
    if (seen.has(identity)) throw new TypeError('Moderation report recipients must be unique')
    seen.add(identity)
    return { userId, publicKey: recipient.publicKey, keyId }
  })
  return recipients.sort((left, right) => left.userId.localeCompare(right.userId) || left.keyId.localeCompare(right.keyId))
}

function compareWraps (left, right) {
  return left.userId.localeCompare(right.userId) || left.keyId.localeCompare(right.keyId)
}

function identifier (value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function hex (value, pattern, label) {
  if (typeof value !== 'string' || !(pattern ? pattern.test(value) : /^[a-f0-9]+$/.test(value)) || value.length % 2 !== 0) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function plainObject (value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value
}

function exactKeys (value, keys, label) {
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${label} contains unsupported field ${key}`)
}

module.exports = {
  MAX_REPORT_NOTE_LENGTH,
  MAX_REPORT_RECIPIENTS,
  REPORT_REASONS,
  REPORT_VERSION,
  createEncryptedReport,
  openEncryptedReport,
  validateEncryptedReportEnvelope,
  validateReportPlaintext
}
