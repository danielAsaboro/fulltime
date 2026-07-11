'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { userIdFromPublicKey, validateKeyPair } = require('./room-identity.js')

const ADMISSION_CLAIM_CONTEXT = 'fulltime/admission-claim/v1'
const HEX_32 = /^[a-f0-9]{64}$/
const HEX_64 = /^[a-f0-9]{128}$/
const ID = /^[a-zA-Z0-9._:-]{3,180}$/
const MAX_RESPONSE_BYTES = 32 * 1024

function createAdmissionClaim (identityKeyPair, fields) {
  validateKeyPair(identityKeyPair)
  const claim = validateAdmissionClaim({
    ...fields,
    admittedBy: userIdFromPublicKey(identityKeyPair.publicKey),
    signature: b4a.toString(b4a.alloc(64), 'hex')
  })
  claim.signature = b4a.toString(crypto.sign(admissionClaimBytes(claim), identityKeyPair.secretKey), 'hex')
  return claim
}

function verifyAdmissionClaim (claim, identityPublicKey) {
  if (!b4a.isBuffer(identityPublicKey) || identityPublicKey.byteLength !== 32) return false
  let validated
  try {
    validated = validateAdmissionClaim(claim)
  } catch {
    return false
  }
  if (validated.admittedBy !== userIdFromPublicKey(identityPublicKey)) return false
  return crypto.verify(admissionClaimBytes(validated), b4a.from(validated.signature, 'hex'), identityPublicKey)
}

function admissionClaimBytes (claim) {
  const value = validateAdmissionClaim(claim)
  return b4a.from(JSON.stringify([
    ADMISSION_CLAIM_CONTEXT,
    value.roomId,
    value.requestId,
    value.inviteId,
    value.receipt,
    value.candidateData,
    value.admittedBy,
    value.issuedAt
  ]))
}

function encodeAdmissionResponse (preview, claim) {
  if (!b4a.isBuffer(preview) || preview.byteLength < 1 || preview.byteLength > 2048) {
    throw new TypeError('Admission response preview is invalid')
  }
  const document = {
    version: 1,
    preview: b4a.toString(preview, 'hex'),
    claim: validateAdmissionClaim(claim)
  }
  const encoded = b4a.from(JSON.stringify(document))
  if (encoded.byteLength > MAX_RESPONSE_BYTES) throw new TypeError('Admission response is too large')
  return encoded
}

function decodeAdmissionResponse (buffer, { preview, roomId, inviteId, candidateData }) {
  if (!b4a.isBuffer(buffer) || buffer.byteLength < 1 || buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new TypeError('Admission response is invalid')
  }
  let document
  try {
    document = JSON.parse(b4a.toString(buffer))
  } catch {
    throw new TypeError('Admission response is not valid JSON')
  }
  if (!plainObject(document) || document.version !== 1 || !onlyKeys(document, ['version', 'preview', 'claim'])) {
    throw new TypeError('Admission response version is unsupported')
  }
  if (typeof document.preview !== 'string' || !/^[a-f0-9]+$/.test(document.preview)) {
    throw new TypeError('Admission response preview is invalid')
  }
  const decodedPreview = b4a.from(document.preview, 'hex')
  if (!b4a.equals(decodedPreview, preview)) throw new TypeError('Pairing response does not match the signed invite preview')
  const claim = validateAdmissionClaim(document.claim)
  if (
    claim.roomId !== roomId ||
    claim.inviteId !== inviteId ||
    claim.candidateData !== b4a.toString(candidateData, 'hex')
  ) throw new TypeError('Admission response does not match this pairing request')
  return claim
}

function validateAdmissionClaim (value) {
  if (!plainObject(value) || !onlyKeys(value, [
    'roomId',
    'requestId',
    'inviteId',
    'receipt',
    'candidateData',
    'admittedBy',
    'issuedAt',
    'signature'
  ])) throw new TypeError('Admission claim must be a closed object')
  if (typeof value.roomId !== 'string' || !ID.test(value.roomId)) throw new TypeError('Admission claim roomId is invalid')
  if (typeof value.requestId !== 'string' || !HEX_32.test(value.requestId)) throw new TypeError('Admission claim requestId is invalid')
  if (typeof value.inviteId !== 'string' || !HEX_32.test(value.inviteId)) throw new TypeError('Admission claim inviteId is invalid')
  if (typeof value.receipt !== 'string' || !/^[a-f0-9]+$/.test(value.receipt) || value.receipt.length > 16_384) {
    throw new TypeError('Admission claim receipt is invalid')
  }
  if (typeof value.candidateData !== 'string' || !/^[a-f0-9]+$/.test(value.candidateData) || value.candidateData.length > 8192) {
    throw new TypeError('Admission claim candidate data is invalid')
  }
  if (typeof value.admittedBy !== 'string' || !ID.test(value.admittedBy)) throw new TypeError('Admission claim signer is invalid')
  if (!Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0) throw new TypeError('Admission claim time is invalid')
  if (typeof value.signature !== 'string' || !HEX_64.test(value.signature)) throw new TypeError('Admission claim signature is invalid')
  return { ...value }
}

function plainObject (value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
}

function onlyKeys (value, allowed) {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}

module.exports = {
  ADMISSION_CLAIM_CONTEXT,
  admissionClaimBytes,
  createAdmissionClaim,
  decodeAdmissionResponse,
  encodeAdmissionResponse,
  validateAdmissionClaim,
  verifyAdmissionClaim
}
