'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const {
  PRESENCE_PROTOCOL_NAME,
  ROOM_PROTOCOL_VERSION
} = require('./room-constants.js')
const { userIdFromPublicKey } = require('./room-identity.js')

const MAX_PRESENCE_FRAME_BYTES = 1024
const PRESENCE_LEASE_MS = 30_000
const PRESENCE_HEARTBEAT_MS = 10_000
const TYPING_LEASE_MS = 6_000
const TYPING_REFRESH_MS = 3_000
const MAX_TRACKED_PRESENCE_STREAMS = 1024

const PRESENCE_TYPE_VALUES = Object.freeze(['presence', 'typing'])
const PRESENCE_STATE_VALUES = Object.freeze(['online', 'away', 'offline'])
const PRESENCE_TYPES = new Set(PRESENCE_TYPE_VALUES)
const PRESENCE_STATES = new Set(PRESENCE_STATE_VALUES)
const ROOM_ID_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/
const HEX_32_PATTERN = /^[a-f0-9]{64}$/
const HEX_64_PATTERN = /^[a-f0-9]{128}$/
const UniversalTextDecoder = typeof TextDecoder === 'undefined' ? require('text-decoder') : TextDecoder
const utf8Decoder = new UniversalTextDecoder('utf-8', { fatal: true })

const COMMON_FIELDS = [
  'version',
  'protocol',
  'type',
  'roomId',
  'userId',
  'identityPublicKey',
  'writerKey',
  'sessionId',
  'sequence',
  'issuedAt',
  'leaseMs'
]

class PresenceProtocolError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'PresenceProtocolError'
    this.code = code
  }
}

function createPresenceSessionId () {
  return b4a.toString(crypto.randomBytes(16), 'hex')
}

function createPresenceFrame ({
  roomId,
  writerKey,
  sessionId,
  sequence,
  identityKeyPair,
  state = 'online',
  issuedAt = Date.now(),
  leaseMs = PRESENCE_LEASE_MS
}) {
  return createSignedFrame({
    type: 'presence',
    roomId,
    writerKey,
    sessionId,
    sequence,
    identityKeyPair,
    issuedAt,
    leaseMs,
    state
  })
}

function createTypingFrame ({
  roomId,
  writerKey,
  sessionId,
  sequence,
  identityKeyPair,
  typing = true,
  issuedAt = Date.now(),
  leaseMs = TYPING_LEASE_MS
}) {
  return createSignedFrame({
    type: 'typing',
    roomId,
    writerKey,
    sessionId,
    sequence,
    identityKeyPair,
    issuedAt,
    leaseMs,
    typing
  })
}

function createSignedFrame (fields) {
  requireIdentityKeyPair(fields.identityKeyPair)
  const frame = {
    version: ROOM_PROTOCOL_VERSION,
    protocol: PRESENCE_PROTOCOL_NAME,
    type: fields.type,
    roomId: fields.roomId,
    userId: userIdFromPublicKey(fields.identityKeyPair.publicKey),
    identityPublicKey: b4a.toString(fields.identityKeyPair.publicKey, 'hex'),
    writerKey: keyHex(fields.writerKey, 'writerKey'),
    sessionId: fields.sessionId,
    sequence: fields.sequence,
    issuedAt: fields.issuedAt,
    leaseMs: fields.leaseMs
  }
  if (fields.type === 'presence') frame.state = fields.state
  if (fields.type === 'typing') frame.typing = fields.typing

  validateUnsignedFrame(frame)
  frame.signature = b4a.toString(
    crypto.sign(signingBytes(frame), fields.identityKeyPair.secretKey),
    'hex'
  )
  return encodeFrame(frame)
}

function parsePresenceFrame (value, expected = {}) {
  const frame = parseFrameJson(value)
  validateSignedFrame(frame)

  const identityPublicKey = b4a.from(frame.identityPublicKey, 'hex')
  if (userIdFromPublicKey(identityPublicKey) !== frame.userId) {
    fail('IDENTITY_MISMATCH', 'Presence userId does not match its identity key')
  }

  const signature = b4a.from(frame.signature, 'hex')
  if (!crypto.verify(signingBytes(frame), signature, identityPublicKey)) {
    fail('INVALID_SIGNATURE', 'Presence signature is invalid')
  }

  validateExpectedBinding(frame, expected)
  return Object.freeze(frame)
}

function safeParsePresenceFrame (value, expected = {}) {
  try {
    return parsePresenceFrame(value, expected)
  } catch {
    return null
  }
}

function verifyPresenceFrame (value, expected = {}) {
  return safeParsePresenceFrame(value, expected) !== null
}

function leaseExpiresAt (frame, receivedAt = Date.now()) {
  if (!Number.isSafeInteger(receivedAt) || receivedAt < 0) {
    throw new TypeError('receivedAt must be a non-negative safe integer')
  }
  if (!frame || !Number.isSafeInteger(frame.leaseMs) || frame.leaseMs < 1) {
    throw new TypeError('frame must contain a valid leaseMs')
  }
  const expiresAt = receivedAt + frame.leaseMs
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError('Presence lease expiration is invalid')
  return expiresAt
}

class PresenceSequenceTracker {
  constructor ({ maximumStreams = MAX_TRACKED_PRESENCE_STREAMS } = {}) {
    if (!Number.isSafeInteger(maximumStreams) || maximumStreams < 1 || maximumStreams > MAX_TRACKED_PRESENCE_STREAMS) {
      throw new TypeError(`maximumStreams must be between 1 and ${MAX_TRACKED_PRESENCE_STREAMS}`)
    }
    this.maximumStreams = maximumStreams
    this.streams = new Map()
  }

  get size () {
    return this.streams.size
  }

  accept (value, expected = {}) {
    const frame = parsePresenceFrame(value, expected)
    const key = sequenceStreamKey(frame)
    const last = this.streams.get(key)
    if (last !== undefined && frame.sequence <= last) {
      fail('NON_MONOTONIC_SEQUENCE', 'Presence sequence must increase for its session')
    }

    // Refresh insertion order so the bounded map evicts the least recently
    // updated session stream.
    if (last !== undefined) this.streams.delete(key)
    this.streams.set(key, frame.sequence)
    while (this.streams.size > this.maximumStreams) {
      this.streams.delete(this.streams.keys().next().value)
    }
    return frame
  }

  clear () {
    this.streams.clear()
  }
}

function sequenceStreamKey (frame) {
  return [
    frame.roomId,
    frame.userId,
    frame.writerKey,
    frame.sessionId
  ].join('|')
}

function parseFrameJson (value) {
  let text
  if (typeof value === 'string') {
    if (b4a.byteLength(value) > MAX_PRESENCE_FRAME_BYTES) {
      fail('FRAME_TOO_LARGE', `Presence frame exceeds ${MAX_PRESENCE_FRAME_BYTES} bytes`)
    }
    text = value
  } else {
    const bytes = asBytes(value)
    if (bytes.byteLength > MAX_PRESENCE_FRAME_BYTES) {
      fail('FRAME_TOO_LARGE', `Presence frame exceeds ${MAX_PRESENCE_FRAME_BYTES} bytes`)
    }
    try {
      text = utf8Decoder.decode(bytes)
    } catch {
      fail('INVALID_ENCODING', 'Presence frame must be valid UTF-8')
    }
  }

  let frame
  try {
    frame = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'Presence frame is not valid JSON')
  }
  if (!isPlainObject(frame)) fail('INVALID_FRAME', 'Presence frame must be a plain object')
  return frame
}

function validateSignedFrame (frame) {
  validateUnsignedFrame(frame, true)
  requireHex(frame.signature, 'signature', HEX_64_PATTERN)
}

function validateUnsignedFrame (frame, signed = false) {
  if (!isPlainObject(frame)) fail('INVALID_FRAME', 'Presence frame must be a plain object')
  if (frame.version !== ROOM_PROTOCOL_VERSION) fail('UNSUPPORTED_VERSION', 'Presence frame version is unsupported')
  if (frame.protocol !== PRESENCE_PROTOCOL_NAME) fail('INVALID_PROTOCOL', 'Presence protocol does not match')
  if (!PRESENCE_TYPES.has(frame.type)) fail('UNSUPPORTED_TYPE', 'Presence frame type is unsupported')
  exactFields(frame, [
    ...COMMON_FIELDS,
    frame.type === 'presence' ? 'state' : 'typing',
    ...(signed ? ['signature'] : [])
  ])

  requirePattern(frame.roomId, 'roomId', ROOM_ID_PATTERN)
  requirePattern(frame.userId, 'userId', /^peer_[a-z0-9]{52}$/)
  requireHex(frame.identityPublicKey, 'identityPublicKey', HEX_32_PATTERN)
  requireHex(frame.writerKey, 'writerKey', HEX_32_PATTERN)
  requirePattern(frame.sessionId, 'sessionId', SESSION_ID_PATTERN)
  requireSafeInteger(frame.sequence, 'sequence')
  requireSafeInteger(frame.issuedAt, 'issuedAt')

  const maximumLease = frame.type === 'presence' ? PRESENCE_LEASE_MS : TYPING_LEASE_MS
  if (!Number.isSafeInteger(frame.leaseMs) || frame.leaseMs < 1 || frame.leaseMs > maximumLease) {
    fail('INVALID_LEASE', `${frame.type} leaseMs must be between 1 and ${maximumLease}`)
  }
  if (frame.type === 'presence' && !PRESENCE_STATES.has(frame.state)) {
    fail('INVALID_STATE', 'Presence state is unsupported')
  }
  if (frame.type === 'typing' && typeof frame.typing !== 'boolean') {
    fail('INVALID_TYPING', 'typing must be a boolean')
  }
}

function validateExpectedBinding (frame, expected) {
  if (expected === undefined) return
  if (!isPlainObject(expected)) throw new TypeError('Expected presence binding must be a plain object')

  compareExpected(frame.roomId, expected.roomId, 'ROOM_MISMATCH', 'Presence room does not match')
  compareExpected(frame.userId, expected.userId, 'USER_MISMATCH', 'Presence user does not match')
  compareExpected(frame.sessionId, expected.sessionId, 'SESSION_MISMATCH', 'Presence session does not match')

  if (expected.identityPublicKey !== undefined) {
    compareExpected(
      frame.identityPublicKey,
      keyHex(expected.identityPublicKey, 'expected.identityPublicKey'),
      'IDENTITY_MISMATCH',
      'Presence identity key does not match'
    )
  }
  if (expected.writerKey !== undefined) {
    compareExpected(
      frame.writerKey,
      keyHex(expected.writerKey, 'expected.writerKey'),
      'WRITER_MISMATCH',
      'Presence writer key does not match'
    )
  }
}

function compareExpected (actual, expected, code, message) {
  if (expected !== undefined && actual !== expected) fail(code, message)
}

function signingBytes (frame) {
  const signal = frame.type === 'presence' ? frame.state : frame.typing
  return b4a.from(JSON.stringify([
    PRESENCE_PROTOCOL_NAME,
    ROOM_PROTOCOL_VERSION,
    frame.type,
    frame.roomId,
    frame.userId,
    frame.identityPublicKey,
    frame.writerKey,
    frame.sessionId,
    frame.sequence,
    frame.issuedAt,
    frame.leaseMs,
    signal
  ]))
}

function encodeFrame (frame) {
  const encoded = b4a.from(JSON.stringify(frame))
  if (encoded.byteLength > MAX_PRESENCE_FRAME_BYTES) {
    fail('FRAME_TOO_LARGE', `Presence frame exceeds ${MAX_PRESENCE_FRAME_BYTES} bytes`)
  }
  return encoded
}

function requireIdentityKeyPair (keyPair) {
  if (!keyPair || !b4a.isBuffer(keyPair.publicKey) || keyPair.publicKey.byteLength !== 32 ||
      !b4a.isBuffer(keyPair.secretKey) || keyPair.secretKey.byteLength !== 64) {
    throw new TypeError('identityKeyPair must contain a 32-byte public key and 64-byte secret key')
  }
}

function keyHex (value, label) {
  if (b4a.isBuffer(value) && value.byteLength === 32) return b4a.toString(value, 'hex')
  if (typeof value === 'string' && HEX_32_PATTERN.test(value)) return value
  throw new TypeError(`${label} must be a 32-byte key or lowercase hex key`)
}

function asBytes (value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  fail('INVALID_FRAME', 'Presence frame must be UTF-8 JSON text or bytes')
}

function exactFields (value, fields) {
  const allowed = new Set(fields)
  const keys = Object.keys(value)
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    fail('INVALID_FIELDS', 'Presence frame fields do not match its closed schema')
  }
}

function requirePattern (value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('INVALID_FIELD', `${label} is invalid`)
}

function requireHex (value, label, pattern) {
  requirePattern(value, label, pattern)
}

function requireSafeInteger (value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_FIELD', `${label} is invalid`)
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function fail (code, message) {
  throw new PresenceProtocolError(code, message)
}

module.exports = {
  MAX_PRESENCE_FRAME_BYTES,
  MAX_TRACKED_PRESENCE_STREAMS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LEASE_MS,
  PRESENCE_STATES: PRESENCE_STATE_VALUES,
  PRESENCE_TYPES: PRESENCE_TYPE_VALUES,
  PresenceProtocolError,
  PresenceSequenceTracker,
  TYPING_LEASE_MS,
  TYPING_REFRESH_MS,
  createPresenceFrame,
  createPresenceSessionId,
  createTypingFrame,
  leaseExpiresAt,
  parsePresenceFrame,
  safeParsePresenceFrame,
  verifyPresenceFrame
}
