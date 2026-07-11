'use strict'

const PROTOCOL_VERSION = 1
const PEER_PROTOCOL = 'fulltime-development-transport-smoke'
const MAX_IPC_FRAME_BYTES = 24 * 1024
const MAX_PEER_FRAME_BYTES = 20 * 1024
const MAX_PAYLOAD_BYTES = 16 * 1024
const MAX_TEXT_BYTES = 8 * 1024
const MAX_DEPTH = 8
const MAX_COLLECTION_SIZE = 128
const MAX_PAYLOAD_COMPLEXITY = 2048
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/
const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

class ProtocolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

function fail(code, message) {
  throw new ProtocolError(code, message)
}

function utf8ByteLength(value) {
  let length = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) length += 1
    else if (code < 0x800) length += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4
        index += 1
      } else length += 3
    } else length += 3
  }
  return length
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail('INVALID_OBJECT', `${label} must be a plain object`)
  return value
}

function requireString(value, label, maximumBytes = 512) {
  if (typeof value !== 'string' || !value || utf8ByteLength(value) > maximumBytes) {
    fail('INVALID_STRING', `${label} must be a non-empty string no larger than ${maximumBytes} bytes`)
  }
  return value
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail('INVALID_IDENTIFIER', `${label} is invalid`)
  }
  return value
}

function requireTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_TIMESTAMP', `${label} is invalid`)
  return value
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4096) {
    fail('INVALID_COUNT', `${label} is invalid`)
  }
  return value
}

function requireRoomCode(value) {
  if (typeof value !== 'string' || !ROOM_PATTERN.test(value)) fail('INVALID_ROOM', 'roomCode is invalid')
  return value
}

function requireVersion(frame) {
  if (frame.version !== PROTOCOL_VERSION) fail('UNSUPPORTED_VERSION', 'Unsupported protocol version')
}

function consumePayloadBudget(state, amount = 1) {
  state.complexity += amount
  if (state.complexity > MAX_PAYLOAD_COMPLEXITY) {
    fail('PAYLOAD_TOO_LARGE', 'Payload contains too many nodes or properties')
  }
}

function visitJson(value, depth = 0, state = { complexity: 0, seen: new WeakSet() }) {
  consumePayloadBudget(state)
  if (depth > MAX_DEPTH) fail('PAYLOAD_TOO_DEEP', `Payload nesting exceeds ${MAX_DEPTH}`)
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_PAYLOAD', 'Payload numbers must be finite')
    return
  }
  if (typeof value === 'string') {
    if (utf8ByteLength(value) > MAX_TEXT_BYTES) {
      fail('TEXT_TOO_LARGE', `Payload strings may not exceed ${MAX_TEXT_BYTES} bytes`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) {
      fail('INVALID_PAYLOAD', 'Payload may not contain cyclic or shared object references')
    }
    state.seen.add(value)
    if (value.length > MAX_COLLECTION_SIZE) fail('PAYLOAD_TOO_LARGE', 'Payload array has too many items')
    for (const item of value) visitJson(item, depth + 1, state)
    return
  }
  if (!isPlainObject(value)) fail('INVALID_PAYLOAD', 'Payload must contain JSON values only')
  if (state.seen.has(value)) {
    fail('INVALID_PAYLOAD', 'Payload may not contain cyclic or shared object references')
  }
  state.seen.add(value)
  const keys = Object.keys(value)
  if (keys.length > MAX_COLLECTION_SIZE) fail('PAYLOAD_TOO_LARGE', 'Payload object has too many keys')
  consumePayloadBudget(state, keys.length)
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) fail('INVALID_PAYLOAD', `Payload key ${key} is not allowed`)
    visitJson(value[key], depth + 1, state)
  }
}

function validatePayload(payload) {
  if (payload === undefined) fail('INVALID_PAYLOAD', 'payload is required')
  visitJson(payload)
  const encoded = JSON.stringify(payload)
  if (encoded === undefined || utf8ByteLength(encoded) > MAX_PAYLOAD_BYTES) {
    fail('PAYLOAD_TOO_LARGE', `Payload may not exceed ${MAX_PAYLOAD_BYTES} bytes`)
  }
  return payload
}

function encodeJsonFrame(value, maximumBytes = MAX_IPC_FRAME_BYTES) {
  const json = JSON.stringify(value)
  if (json === undefined) fail('INVALID_FRAME', 'Frame is not JSON serializable')
  if (utf8ByteLength(json) > maximumBytes) fail('FRAME_TOO_LARGE', `Frame exceeds ${maximumBytes} bytes`)
  return json
}

function parseJsonFrame(value, maximumBytes = MAX_IPC_FRAME_BYTES) {
  if (typeof value !== 'string') fail('INVALID_FRAME', 'Frame must be UTF-8 JSON text')
  if (utf8ByteLength(value) > maximumBytes) fail('FRAME_TOO_LARGE', `Frame exceeds ${maximumBytes} bytes`)
  let frame
  try {
    frame = JSON.parse(value)
  } catch {
    fail('INVALID_JSON', 'Frame contains invalid JSON')
  }
  return requireObject(frame, 'Frame')
}

function validateBridgeCommand(command) {
  requireObject(command, 'Command')
  if (command.type !== 'transport.send') fail('INVALID_COMMAND', 'Only transport.send is allowed')
  return { type: command.type, payload: validatePayload(command.payload) }
}

function validateWorkerCommand(frame) {
  requireObject(frame, 'Worker command')
  requireVersion(frame)
  requireIdentifier(frame.requestId, 'requestId')
  if (frame.type === 'transport.close') return frame
  if (frame.type !== 'transport.send') fail('INVALID_COMMAND', 'Unknown worker command')
  requireIdentifier(frame.messageId, 'messageId')
  requireTimestamp(frame.sentAt, 'sentAt')
  validatePayload(frame.payload)
  return frame
}

function validatePeerEnvelope(frame, expectedRoomCode) {
  requireObject(frame, 'Peer frame')
  requireVersion(frame)
  if (frame.protocol !== PEER_PROTOCOL) fail('INVALID_PROTOCOL', 'Peer protocol does not match')
  requireRoomCode(frame.roomCode)
  if (frame.roomCode !== expectedRoomCode) fail('ROOM_MISMATCH', 'Peer room does not match')
  if (frame.type === 'transport.hello') {
    requireString(frame.displayName, 'displayName', 96)
    return frame
  }
  if (frame.type !== 'transport.message') fail('INVALID_PEER_FRAME', 'Unknown peer frame type')
  requireIdentifier(frame.messageId, 'messageId')
  requireTimestamp(frame.sentAt, 'sentAt')
  validatePayload(frame.payload)
  return frame
}

function validateTransportEvent(frame) {
  requireObject(frame, 'Transport event')
  requireVersion(frame)
  switch (frame.type) {
    case 'transport.ready':
      if (frame.mode !== 'development-transport-smoke') fail('INVALID_EVENT', 'ready mode is invalid')
      requireRoomCode(frame.roomCode)
      requireString(frame.displayName, 'displayName', 96)
      requireIdentifier(frame.peerId, 'peerId')
      requireCount(frame.peerCount, 'peerCount')
      break
    case 'transport.peers':
      requireCount(frame.count, 'count')
      requireTimestamp(frame.at, 'at')
      break
    case 'transport.peer-joined':
    case 'transport.peer-left':
      requireIdentifier(frame.peerId, 'peerId')
      requireString(frame.displayName, 'displayName', 96)
      requireCount(frame.peerCount, 'peerCount')
      requireTimestamp(frame.at, 'at')
      break
    case 'transport.message':
      requireIdentifier(frame.messageId, 'messageId')
      requireObject(frame.from, 'from')
      requireIdentifier(frame.from.peerId, 'from.peerId')
      requireString(frame.from.displayName, 'from.displayName', 96)
      if (typeof frame.from.isSelf !== 'boolean') fail('INVALID_EVENT', 'from.isSelf must be a boolean')
      requireTimestamp(frame.sentAt, 'sentAt')
      requireTimestamp(frame.receivedAt, 'receivedAt')
      validatePayload(frame.payload)
      break
    case 'transport.error':
      requireIdentifier(frame.code, 'code')
      requireString(frame.message, 'message', 512)
      if (typeof frame.recoverable !== 'boolean') fail('INVALID_EVENT', 'recoverable must be a boolean')
      break
    default:
      fail('INVALID_EVENT', 'Unknown transport event')
  }
  return frame
}

function validateWorkerFrame(frame) {
  requireObject(frame, 'Worker frame')
  requireVersion(frame)
  if (frame.type !== 'transport.response') return validateTransportEvent(frame)
  requireIdentifier(frame.requestId, 'requestId')
  if (typeof frame.ok !== 'boolean') fail('INVALID_RESPONSE', 'response.ok must be a boolean')
  if (frame.ok) {
    if (frame.messageId !== undefined) requireIdentifier(frame.messageId, 'messageId')
    if (frame.queuedTo !== undefined) requireCount(frame.queuedTo, 'queuedTo')
  } else {
    requireIdentifier(frame.errorCode, 'errorCode')
    requireString(frame.errorMessage, 'errorMessage', 512)
  }
  return frame
}

module.exports = {
  MAX_IPC_FRAME_BYTES,
  MAX_PAYLOAD_COMPLEXITY,
  MAX_PAYLOAD_BYTES,
  MAX_PEER_FRAME_BYTES,
  MAX_TEXT_BYTES,
  PEER_PROTOCOL,
  PROTOCOL_VERSION,
  ProtocolError,
  encodeJsonFrame,
  parseJsonFrame,
  utf8ByteLength,
  validateBridgeCommand,
  validatePayload,
  validatePeerEnvelope,
  validateTransportEvent,
  validateWorkerCommand,
  validateWorkerFrame
}
