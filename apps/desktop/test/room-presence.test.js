'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { PRESENCE_PROTOCOL_NAME, ROOM_PROTOCOL_VERSION } = require('../lib/room-constants.js')
const { createIdentity, userIdFromPublicKey } = require('../lib/room-identity.js')
const {
  MAX_PRESENCE_FRAME_BYTES,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LEASE_MS,
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
} = require('../lib/room-presence.js')

function fixture () {
  return {
    identityKeyPair: createIdentity().keyPair,
    roomId: 'room_fra-mar_2026',
    sessionId: createPresenceSessionId(),
    writerKey: crypto.randomBytes(32)
  }
}

function frameObject (frame) {
  return JSON.parse(b4a.toString(frame))
}

test('presence defaults expose bounded heartbeat and lease timings', () => {
  assert.equal(MAX_PRESENCE_FRAME_BYTES, 1024)
  assert.equal(PRESENCE_LEASE_MS, 30_000)
  assert.equal(PRESENCE_HEARTBEAT_MS, 10_000)
  assert.equal(TYPING_LEASE_MS, 6_000)
  assert.equal(TYPING_REFRESH_MS, 3_000)
  assert.ok(PRESENCE_HEARTBEAT_MS < PRESENCE_LEASE_MS)
  assert.ok(TYPING_REFRESH_MS < TYPING_LEASE_MS)

  assert.match(createPresenceSessionId(), /^[a-f0-9]{32}$/)
  assert.notEqual(createPresenceSessionId(), createPresenceSessionId())
})

test('presence frames are signed and bind the room, identity, writer, and session', () => {
  const fields = fixture()
  const issuedAt = 1_720_000_000_000
  const encoded = createPresenceFrame({ ...fields, sequence: 4, issuedAt })
  assert.ok(encoded.byteLength <= MAX_PRESENCE_FRAME_BYTES)

  const frame = parsePresenceFrame(encoded, {
    roomId: fields.roomId,
    userId: userIdFromPublicKey(fields.identityKeyPair.publicKey),
    identityPublicKey: fields.identityKeyPair.publicKey,
    writerKey: fields.writerKey,
    sessionId: fields.sessionId
  })
  assert.equal(frame.version, ROOM_PROTOCOL_VERSION)
  assert.equal(frame.protocol, PRESENCE_PROTOCOL_NAME)
  assert.equal(frame.type, 'presence')
  assert.equal(frame.state, 'online')
  assert.equal(frame.sequence, 4)
  assert.equal(frame.issuedAt, issuedAt)
  assert.equal(frame.leaseMs, PRESENCE_LEASE_MS)
  assert.equal(frame.writerKey, b4a.toString(fields.writerKey, 'hex'))
  assert.equal(leaseExpiresAt(frame, issuedAt + 500), issuedAt + 500 + PRESENCE_LEASE_MS)
  assert.equal(Object.isFrozen(frame), true)
})

test('typing frames use their shorter lease and a closed boolean signal', () => {
  const fields = fixture()
  const encoded = createTypingFrame({
    ...fields,
    sequence: 0,
    issuedAt: 123,
    typing: false,
    leaseMs: 2_500
  })
  const frame = parsePresenceFrame(encoded)
  assert.equal(frame.type, 'typing')
  assert.equal(frame.typing, false)
  assert.equal(frame.leaseMs, 2_500)
  assert.equal(Object.hasOwn(frame, 'state'), false)

  assert.throws(
    () => createTypingFrame({ ...fields, sequence: 1, typing: 'yes' }),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_TYPING'
  )
  assert.throws(
    () => createPresenceFrame({ ...fields, sequence: 1, state: 'busy' }),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_STATE'
  )
})

test('closed schemas reject unknown types, extra fields, invalid UTF-8, and oversized input', () => {
  const fields = fixture()
  const valid = frameObject(createPresenceFrame({ ...fields, sequence: 0 }))

  const extra = { ...valid, arbitrary: true }
  assert.throws(
    () => parsePresenceFrame(JSON.stringify(extra)),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_FIELDS'
  )

  const unknown = { ...valid, type: 'presence.query' }
  assert.throws(
    () => parsePresenceFrame(JSON.stringify(unknown)),
    (error) => error instanceof PresenceProtocolError && error.code === 'UNSUPPORTED_TYPE'
  )

  assert.throws(
    () => parsePresenceFrame(new Uint8Array([0xc3, 0x28])),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_ENCODING'
  )
  assert.throws(
    () => parsePresenceFrame('x'.repeat(MAX_PRESENCE_FRAME_BYTES + 1)),
    (error) => error instanceof PresenceProtocolError && error.code === 'FRAME_TOO_LARGE'
  )
})

test('signature verification detects changes to every bound identity dimension', () => {
  const fields = fixture()
  const encoded = createPresenceFrame({ ...fields, sequence: 7 })
  const changes = [
    ['roomId', 'room_other'],
    ['writerKey', b4a.toString(crypto.randomBytes(32), 'hex')],
    ['sessionId', createPresenceSessionId()],
    ['sequence', 8],
    ['state', 'away']
  ]

  for (const [name, value] of changes) {
    const changed = { ...frameObject(encoded), [name]: value }
    assert.equal(verifyPresenceFrame(JSON.stringify(changed)), false, name)
  }

  const changedUser = {
    ...frameObject(encoded),
    userId: userIdFromPublicKey(createIdentity().keyPair.publicKey)
  }
  assert.throws(
    () => parsePresenceFrame(JSON.stringify(changedUser)),
    (error) => error instanceof PresenceProtocolError && error.code === 'IDENTITY_MISMATCH'
  )
  assert.equal(safeParsePresenceFrame('{ definitely not JSON'), null)
})

test('expected bindings reject a valid frame from the wrong member or room', () => {
  const fields = fixture()
  const encoded = createPresenceFrame({ ...fields, sequence: 0 })

  assert.throws(
    () => parsePresenceFrame(encoded, { roomId: 'room_other' }),
    (error) => error instanceof PresenceProtocolError && error.code === 'ROOM_MISMATCH'
  )
  assert.throws(
    () => parsePresenceFrame(encoded, { writerKey: crypto.randomBytes(32) }),
    (error) => error instanceof PresenceProtocolError && error.code === 'WRITER_MISMATCH'
  )
  assert.throws(
    () => parsePresenceFrame(encoded, { sessionId: createPresenceSessionId() }),
    (error) => error instanceof PresenceProtocolError && error.code === 'SESSION_MISMATCH'
  )
})

test('sequences increase monotonically across all signals in a signed session', () => {
  const fields = fixture()
  const tracker = new PresenceSequenceTracker()

  tracker.accept(createPresenceFrame({ ...fields, sequence: 0 }))
  tracker.accept(createPresenceFrame({ ...fields, sequence: 1 }))
  assert.throws(
    () => tracker.accept(createPresenceFrame({ ...fields, sequence: 1 })),
    (error) => error instanceof PresenceProtocolError && error.code === 'NON_MONOTONIC_SEQUENCE'
  )
  assert.throws(
    () => tracker.accept(createPresenceFrame({ ...fields, sequence: 0 })),
    (error) => error instanceof PresenceProtocolError && error.code === 'NON_MONOTONIC_SEQUENCE'
  )

  tracker.accept(createTypingFrame({ ...fields, sequence: 2 }))
  assert.throws(
    () => tracker.accept(createPresenceFrame({ ...fields, sequence: 1 })),
    (error) => error instanceof PresenceProtocolError && error.code === 'NON_MONOTONIC_SEQUENCE'
  )

  // A new process session starts a new monotonic stream.
  tracker.accept(createPresenceFrame({ ...fields, sessionId: createPresenceSessionId(), sequence: 0 }))
  assert.equal(tracker.size, 2)
})

test('invalid signed input cannot advance sequence state and the tracker is bounded', () => {
  const fields = fixture()
  const tracker = new PresenceSequenceTracker({ maximumStreams: 2 })
  const tampered = frameObject(createPresenceFrame({ ...fields, sequence: 999 }))
  tampered.writerKey = b4a.toString(crypto.randomBytes(32), 'hex')
  assert.throws(
    () => tracker.accept(JSON.stringify(tampered)),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_SIGNATURE'
  )

  tracker.accept(createPresenceFrame({ ...fields, sequence: 0 }))
  tracker.accept(createPresenceFrame({ ...fields, sessionId: createPresenceSessionId(), sequence: 0 }))
  tracker.accept(createPresenceFrame({ ...fields, sessionId: createPresenceSessionId(), sequence: 0 }))
  assert.equal(tracker.size, 2)
  tracker.clear()
  assert.equal(tracker.size, 0)
})

test('lease and identifier limits keep even maximum-size valid frames below 1024 bytes', () => {
  const fields = fixture()
  const roomId = `r_${'a'.repeat(178)}`
  const encoded = createPresenceFrame({ ...fields, roomId, sequence: Number.MAX_SAFE_INTEGER })
  assert.ok(encoded.byteLength <= MAX_PRESENCE_FRAME_BYTES)
  assert.equal(parsePresenceFrame(encoded).roomId, roomId)

  assert.throws(
    () => createPresenceFrame({ ...fields, sequence: 0, leaseMs: PRESENCE_LEASE_MS + 1 }),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_LEASE'
  )
  assert.throws(
    () => createTypingFrame({ ...fields, sequence: 0, leaseMs: TYPING_LEASE_MS + 1 }),
    (error) => error instanceof PresenceProtocolError && error.code === 'INVALID_LEASE'
  )
})
