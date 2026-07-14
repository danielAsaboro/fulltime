'use strict'

const b4a = require('b4a')
const c = require('compact-encoding')
const messages = require('hypercore/lib/messages')

const FIXTURE_PROOF_STREAM_VERSION = 1
const MAX_FIXTURE_PROOF_BYTES = 256 * 1024

function encodeFixtureProof ({ index, proof }) {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Fixture proof index is invalid')
  if (!proof || typeof proof !== 'object') throw new TypeError('Fixture proof is required')
  if (!proof.block || proof.block.index !== index) throw new TypeError('Fixture proof block index does not match its envelope')
  const encoded = c.encode(messages.wire.data, { request: 0, ...proof })
  const payload = b4a.allocUnsafe(encoded.byteLength + 1)
  payload[0] = FIXTURE_PROOF_STREAM_VERSION
  payload.set(encoded, 1)
  if (payload.byteLength > MAX_FIXTURE_PROOF_BYTES) throw new RangeError('Fixture proof exceeds the byte limit')
  return payload
}

function decodeFixtureProof (payload) {
  if (!b4a.isBuffer(payload) && !(payload instanceof Uint8Array)) {
    throw new TypeError('Fixture proof payload must be binary')
  }
  if (payload.byteLength < 2 || payload.byteLength > MAX_FIXTURE_PROOF_BYTES) {
    throw new RangeError('Fixture proof payload has an invalid size')
  }
  if (payload[0] !== FIXTURE_PROOF_STREAM_VERSION) throw new TypeError('Fixture proof stream version is unsupported')
  let decoded
  try {
    decoded = c.decode(messages.wire.data, payload.subarray(1))
  } catch (error) {
    throw new TypeError('Fixture proof payload is not valid Hypercore wire data', { cause: error })
  }
  if (!decoded || typeof decoded !== 'object' || decoded.request !== 0 ||
      !decoded.block || !Number.isSafeInteger(decoded.block.index) || decoded.block.index < 0) {
    throw new TypeError('Fixture proof wire envelope is invalid')
  }
  const { request, ...wireProof } = decoded
  const proof = copyBinaryValues(wireProof)
  return { index: proof.block.index, proof }
}

function encodeFixtureProofRequest ({ length, start }) {
  if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('Fixture proof request length is invalid')
  if (!Number.isSafeInteger(start) || start < 0 || start > length) throw new TypeError('Fixture proof request start is invalid')
  return b4a.from(`${JSON.stringify({ version: FIXTURE_PROOF_STREAM_VERSION, length, start })}\n`)
}

function decodeFixtureProofRequest (payload) {
  if (!b4a.isBuffer(payload) && !(payload instanceof Uint8Array)) {
    throw new TypeError('Fixture proof request must be binary')
  }
  if (payload.byteLength < 2 || payload.byteLength > 256) throw new RangeError('Fixture proof request has an invalid size')
  let parsed
  try {
    parsed = JSON.parse(b4a.toString(payload, 'utf8'))
  } catch {
    throw new TypeError('Fixture proof request is not valid JSON')
  }
  if (!plainObject(parsed) || Object.keys(parsed).length !== 3 ||
      parsed.version !== FIXTURE_PROOF_STREAM_VERSION ||
      !Number.isSafeInteger(parsed.length) || parsed.length < 0 ||
      !Number.isSafeInteger(parsed.start) || parsed.start < 0 || parsed.start > parsed.length) {
    throw new TypeError('Fixture proof request is invalid')
  }
  return { length: parsed.length, start: parsed.start }
}

function frameFixtureProof (payload) {
  if (!b4a.isBuffer(payload) && !(payload instanceof Uint8Array)) throw new TypeError('Fixture proof frame must be binary')
  if (payload.byteLength < 2 || payload.byteLength > MAX_FIXTURE_PROOF_BYTES) {
    throw new RangeError('Fixture proof frame has an invalid size')
  }
  const frame = b4a.allocUnsafe(4 + payload.byteLength)
  frame[0] = (payload.byteLength >>> 24) & 0xff
  frame[1] = (payload.byteLength >>> 16) & 0xff
  frame[2] = (payload.byteLength >>> 8) & 0xff
  frame[3] = payload.byteLength & 0xff
  frame.set(payload, 4)
  return frame
}

function plainObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function copyBinaryValues (value) {
  if (b4a.isBuffer(value) || value instanceof Uint8Array || ArrayBuffer.isView(value)) {
    const copy = b4a.alloc(value.byteLength)
    copy.set(value)
    return copy
  }
  if (Array.isArray(value)) return value.map(copyBinaryValues)
  if (!value || typeof value !== 'object') return value
  const copy = {}
  for (const [key, entry] of Object.entries(value)) copy[key] = copyBinaryValues(entry)
  return copy
}

module.exports = {
  FIXTURE_PROOF_STREAM_VERSION,
  MAX_FIXTURE_PROOF_BYTES,
  decodeFixtureProof,
  decodeFixtureProofRequest,
  encodeFixtureProof,
  encodeFixtureProofRequest,
  frameFixtureProof
}
