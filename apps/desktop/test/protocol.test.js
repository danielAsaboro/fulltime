'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { parseLaunchOptions, parseWorkerOptions } = require('../lib/config.js')
const { FrameTooLargeError, PeerFrameDecoder, encodePeerFrame } = require('../lib/peer-frame.js')
const {
  MAX_PAYLOAD_BYTES,
  MAX_PAYLOAD_COMPLEXITY,
  MAX_TEXT_BYTES,
  PEER_PROTOCOL,
  PROTOCOL_VERSION,
  ProtocolError,
  encodeJsonFrame,
  parseJsonFrame,
  validateBridgeCommand,
  validatePeerEnvelope,
  validateWorkerCommand,
  validateWorkerFrame
} = require('../lib/protocol.js')
const { deriveDevelopmentTopic } = require('../lib/topic.js')

const requestId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'

test('launch flags isolate storage, room, and display name', () => {
  const options = parseLaunchOptions(
    ['--storage=/tmp/fulltime-b', '--room', 'ROOM-FRA-MAR', '--name', '  Jo   Mensah  '],
    { storagePath: '/tmp/default', roomCode: 'default-room', displayName: 'Default' }
  )
  assert.deepEqual(options, {
    storagePath: '/tmp/fulltime-b',
    roomCode: 'room-fra-mar',
    displayName: 'Jo Mensah'
  })
  assert.throws(
    () => parseLaunchOptions(['--room', 'one-room', '--room', 'two-room'], options),
    /only be provided once/
  )
})

test('worker accepts only a complete isolated argument set', () => {
  const topicHex = 'ab'.repeat(32)
  assert.deepEqual(
    parseWorkerOptions([
      '--storage', '/tmp/peer-a', '--room', 'room-fra-mar', '--name', 'Amina', '--topic', topicHex
    ]),
    { storagePath: '/tmp/peer-a', roomCode: 'room-fra-mar', displayName: 'Amina', topicHex }
  )
  assert.throws(() => parseWorkerOptions(['--room', 'room-fra-mar']), /requires valid/)
})

test('worker accepts an explicit bounded DHT bootstrap list', () => {
  const bootstrap = [{ host: '127.0.0.1', port: 49152 }]
  const options = parseWorkerOptions([
    '--storage', '/tmp/peer-a',
    '--room', 'room-fra-mar',
    '--name', 'Amina',
    '--topic', 'ab'.repeat(32),
    '--bootstrap', JSON.stringify(bootstrap)
  ])
  assert.deepEqual(options.bootstrap, bootstrap)
  assert.throws(
    () => parseWorkerOptions([
      '--storage', '/tmp/peer-a',
      '--room', 'room-fra-mar',
      '--name', 'Amina',
      '--topic', 'ab'.repeat(32),
      '--bootstrap', JSON.stringify([{ host: '127.0.0.1', port: 70000 }])
    ]),
    /valid host and port/
  )
})

test('development topic is deterministic, room-scoped, and 32 bytes', () => {
  const first = deriveDevelopmentTopic('room-fra-mar')
  assert.equal(first, deriveDevelopmentTopic('ROOM-FRA-MAR'))
  assert.notEqual(first, deriveDevelopmentTopic('room-usa-mex'))
  assert.match(first, /^[a-f0-9]{64}$/)
})

test('peer decoder handles fragmented and coalesced length-prefixed frames', () => {
  const first = encodePeerFrame(new TextEncoder().encode('first'), 64)
  const second = encodePeerFrame(new TextEncoder().encode('second'), 64)
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first)
  joined.set(second, first.length)

  const decoder = new PeerFrameDecoder(64)
  assert.deepEqual(decoder.push(joined.subarray(0, 3)), [])
  const decoded = decoder.push(joined.subarray(3))
  assert.deepEqual(decoded.map((value) => new TextDecoder().decode(value)), ['first', 'second'])
})

test('peer decoder rejects the declared size before allocating a body', () => {
  const header = new Uint8Array([0, 0, 1, 0])
  const decoder = new PeerFrameDecoder(64)
  assert.throws(() => decoder.push(header), FrameTooLargeError)
})

test('bridge commands accept bounded JSON payloads only', () => {
  assert.deepEqual(validateBridgeCommand({ type: 'transport.send', payload: { kind: 'text', text: 'Goal!' } }), {
    type: 'transport.send',
    payload: { kind: 'text', text: 'Goal!' }
  })
  assert.throws(
    () => validateBridgeCommand({ type: 'transport.send', payload: { text: 'x'.repeat(MAX_TEXT_BYTES + 1) } }),
    (error) => error instanceof ProtocolError && error.code === 'TEXT_TOO_LARGE'
  )
  assert.throws(
    () => validateBridgeCommand({ type: 'transport.send', payload: JSON.parse('{"__proto__":true}') }),
    /not allowed/
  )
  assert.throws(() => validateBridgeCommand({ type: 'transport.close' }), /Only transport.send/)
})

test('payload validation rejects cyclic and shared object references', () => {
  const cyclic = { kind: 'text' }
  cyclic.self = cyclic
  assert.throws(
    () => validateBridgeCommand({ type: 'transport.send', payload: cyclic }),
    (error) => error instanceof ProtocolError &&
      error.code === 'INVALID_PAYLOAD' &&
      /cyclic or shared/.test(error.message)
  )

  const shared = { text: 'Goal!' }
  assert.throws(
    () => validateBridgeCommand({
      type: 'transport.send',
      payload: { first: shared, second: shared }
    }),
    (error) => error instanceof ProtocolError &&
      error.code === 'INVALID_PAYLOAD' &&
      /cyclic or shared/.test(error.message)
  )
})

test('payload validation enforces a cumulative node and property budget', () => {
  const payload = Array.from({ length: 8 }, (_, group) => Object.fromEntries(
    Array.from({ length: 128 }, (_, index) => [`k${group}_${index}`, null])
  ))

  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < MAX_PAYLOAD_BYTES)
  assert.ok(1 + 8 + (8 * 128 * 2) > MAX_PAYLOAD_COMPLEXITY)
  assert.throws(
    () => validateBridgeCommand({ type: 'transport.send', payload }),
    (error) => error instanceof ProtocolError &&
      error.code === 'PAYLOAD_TOO_LARGE' &&
      /nodes or properties/.test(error.message)
  )
})

test('worker commands and responses correlate with protocol version 1', () => {
  const command = {
    version: PROTOCOL_VERSION,
    type: 'transport.send',
    requestId,
    messageId,
    sentAt: 1_720_000_000_000,
    payload: { kind: 'text', text: 'What a finish' }
  }
  assert.equal(validateWorkerCommand(parseJsonFrame(encodeJsonFrame(command))).type, command.type)
  const response = {
    version: PROTOCOL_VERSION,
    type: 'transport.response',
    requestId,
    ok: true,
    messageId,
    queuedTo: 2
  }
  assert.equal(validateWorkerFrame(parseJsonFrame(encodeJsonFrame(response))).requestId, requestId)
  assert.throws(() => validateWorkerCommand({ ...command, version: 2 }), /Unsupported protocol version/)
})

test('peer handshake and message frames are room-scoped and versioned', () => {
  const hello = {
    version: PROTOCOL_VERSION,
    protocol: PEER_PROTOCOL,
    type: 'transport.hello',
    roomCode: 'room-fra-mar',
    displayName: 'Theo'
  }
  assert.equal(validatePeerEnvelope(hello, 'room-fra-mar').displayName, 'Theo')
  assert.throws(() => validatePeerEnvelope(hello, 'room-usa-mex'), /does not match/)

  const message = {
    version: PROTOCOL_VERSION,
    protocol: PEER_PROTOCOL,
    type: 'transport.message',
    roomCode: 'room-fra-mar',
    messageId,
    sentAt: Date.now(),
    payload: { text: 'Varying timestamps are preserved' }
  }
  assert.equal(validatePeerEnvelope(message, 'room-fra-mar').messageId, messageId)
})

test('JSON frame encoder enforces byte limits', () => {
  assert.throws(() => encodeJsonFrame({ payload: 'x'.repeat(MAX_PAYLOAD_BYTES) }, 128), /Frame exceeds/)
})
