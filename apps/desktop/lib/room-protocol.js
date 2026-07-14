'use strict'

const { MAX_ROOM_IPC_BYTES } = require('./room-constants.js')

const ROOM_IPC_VERSION = 2
const MAX_ACTION_LENGTH = 80
const MAX_ID_LENGTH = 128
const MAX_DEPTH = 12
const MAX_COLLECTION_SIZE = 4096
const MAX_COMPLEXITY = 50_000

const ROOM_ACTIONS = new Set([
  'system.config',
  'system.close',
  'session.get',
  'session.sign-in',
  'session.sign-out',
  'fixture.list',
  'fixture.get',
  'fixture.intelligence',
  'record.get',
  'room.list',
  'room.get',
  'room.preview-invite',
  'room.create',
  'room.join',
  'room.details',
  'room.state',
  'room.answer.submit',
  'room.receipt.get',
  'room.replay',
  'room.history.page',
  'room.thread.page',
  'room.message.send',
  'room.media.upload.begin',
  'room.media.upload.chunk',
  'room.media.upload.commit',
  'room.media.upload.abort',
  'room.media.download.begin',
  'room.media.download.chunk',
  'room.media.download.close',
  'room.notification.settings',
  'room.notification.settings.update',
  'room.report',
  'room.reports.list',
  'room.poll.create',
  'room.poll.vote',
  'room.market.reference',
  'room.item.react',
  'room.reply.send',
  'room.read.mark',
  'room.invite.create',
  'room.invite.regenerate',
  'room.invite.revoke',
  'room.rename',
  'room.member.remove',
  'room.member.role',
  'room.slow-mode',
  'room.close',
  'room.leave',
  'room.typing.set',
  'notification.pending',
  'notification.lifecycle'
])

const EVENT_TYPES = new Set(['bridge.ready', 'fixture.updated', 'room.state', 'room.details', 'room.error', 'transport.status', 'notification.queued'])
const ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

class RoomProtocolError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'RoomProtocolError'
    this.code = code
  }
}

function fail (code, message) {
  throw new RoomProtocolError(code, message)
}

function plainObject (value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT', `${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail('INVALID_OBJECT', `${label} must be a plain object`)
  return value
}

function validateJson (value) {
  const state = { complexity: 0, seen: new WeakSet() }
  visit(value, 0, state)
  const json = JSON.stringify(value)
  if (json === undefined || Buffer.byteLength(json) > MAX_ROOM_IPC_BYTES) {
    fail('FRAME_TOO_LARGE', `Room IPC frames may not exceed ${MAX_ROOM_IPC_BYTES} bytes`)
  }
  return value
}

function visit (value, depth, state) {
  if (++state.complexity > MAX_COMPLEXITY) fail('PAYLOAD_TOO_LARGE', 'Payload is too complex')
  if (depth > MAX_DEPTH) fail('PAYLOAD_TOO_DEEP', 'Payload nesting is too deep')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_NUMBER', 'Payload numbers must be finite')
    return
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > MAX_ROOM_IPC_BYTES) fail('STRING_TOO_LARGE', 'Payload string is too large')
    return
  }
  if (typeof value !== 'object') fail('INVALID_PAYLOAD', 'Payload must contain JSON values only')
  if (state.seen.has(value)) fail('INVALID_PAYLOAD', 'Payload cannot contain cycles or shared references')
  state.seen.add(value)
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_SIZE) fail('PAYLOAD_TOO_LARGE', 'Payload array is too large')
    for (const child of value) visit(child, depth + 1, state)
    return
  }
  plainObject(value, 'Payload value')
  const keys = Object.keys(value)
  if (keys.length > MAX_COLLECTION_SIZE) fail('PAYLOAD_TOO_LARGE', 'Payload object has too many keys')
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) fail('INVALID_PAYLOAD', `Payload key ${key} is not allowed`)
    visit(value[key], depth + 1, state)
  }
}

function validateId (value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('INVALID_ID', 'Request ID is invalid')
  return value
}

function validateAction (value) {
  if (typeof value !== 'string' || value.length > MAX_ACTION_LENGTH || !ROOM_ACTIONS.has(value)) {
    fail('INVALID_ACTION', 'Room action is unsupported')
  }
  return value
}

function validateRequest (frame) {
  plainObject(frame, 'Room request')
  if (frame.version !== ROOM_IPC_VERSION) fail('UNSUPPORTED_VERSION', 'Unsupported room IPC request')
  requireOnlyKeys(frame, ['version', 'id', 'action', 'payload'], 'Room request')
  validateId(frame.id)
  validateAction(frame.action)
  validateJson(frame.payload === undefined ? null : frame.payload)
  return frame
}

function validateResponse (frame) {
  plainObject(frame, 'Room response')
  if (frame.version !== ROOM_IPC_VERSION) fail('UNSUPPORTED_VERSION', 'Unsupported room IPC response')
  validateId(frame.id)
  if (typeof frame.ok !== 'boolean') fail('INVALID_RESPONSE', 'Response status is invalid')
  if (frame.ok) {
    requireOnlyKeys(frame, ['version', 'id', 'ok', 'result'], 'Room response')
    if (!Object.hasOwn(frame, 'result')) fail('INVALID_RESPONSE', 'Response result is missing')
    validateJson(frame.result)
  }
  else {
    requireOnlyKeys(frame, ['version', 'id', 'ok', 'error'], 'Room response')
    plainObject(frame.error, 'Response error')
    requireOnlyKeys(frame.error, ['code', 'message', 'recoverable', 'details'], 'Response error')
    if (typeof frame.error.code !== 'string' || !frame.error.code || frame.error.code.length > 80) {
      fail('INVALID_RESPONSE', 'Response error code is invalid')
    }
    if (typeof frame.error.message !== 'string' || !frame.error.message || Buffer.byteLength(frame.error.message) > 1024) {
      fail('INVALID_RESPONSE', 'Response error message is invalid')
    }
    if (typeof frame.error.recoverable !== 'boolean') fail('INVALID_RESPONSE', 'Response recoverability is invalid')
    if (Object.hasOwn(frame.error, 'details')) validateJson(frame.error.details)
  }
  return frame
}

function validateEvent (frame) {
  plainObject(frame, 'Room event')
  if (frame.version !== ROOM_IPC_VERSION || !EVENT_TYPES.has(frame.type)) fail('INVALID_EVENT', 'Room event is invalid')
  validateJson(frame)
  return frame
}

function encodeRoomFrame (frame) {
  validateJson(frame)
  return JSON.stringify(frame)
}

function parseRoomFrame (buffer) {
  if (!Buffer.isBuffer(buffer) && typeof buffer !== 'string') fail('INVALID_FRAME', 'Room frame must be UTF-8 data')
  if (buffer.length > MAX_ROOM_IPC_BYTES) fail('FRAME_TOO_LARGE', 'Room frame is too large')
  let frame
  try {
    frame = JSON.parse(buffer.toString())
  } catch {
    fail('INVALID_JSON', 'Room frame is not valid JSON')
  }
  return plainObject(frame, 'Room frame')
}

function errorResponse (id, error) {
  const code = typeof error?.code === 'string' && error.code ? error.code.slice(0, 80) : 'ROOM_REQUEST_FAILED'
  const message = error instanceof Error && error.message ? error.message.slice(0, 1024) : 'Room request failed'
  return { version: ROOM_IPC_VERSION, id, ok: false, error: { code, message, recoverable: true } }
}

function requireOnlyKeys (value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('INVALID_OBJECT', `${label} contains an unsupported field`)
  }
}

module.exports = {
  EVENT_TYPES,
  ROOM_ACTIONS,
  ROOM_IPC_VERSION,
  RoomProtocolError,
  encodeRoomFrame,
  errorResponse,
  parseRoomFrame,
  validateAction,
  validateEvent,
  validateJson,
  validateRequest,
  validateResponse
}
