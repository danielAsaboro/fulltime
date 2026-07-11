'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const z32 = require('z32')

const { MAX_DISPLAY_NAME_LENGTH } = require('./room-constants.js')

const MEMBER_BINDING_CONTEXT = 'fulltime/member-binding/v1'
const ROOM_ID_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/
const UNSAFE_DISPLAY_NAME_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

function normalizeDisplayName (value) {
  if (typeof value !== 'string') throw new TypeError('Display name must be a string')
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!name || name.length > MAX_DISPLAY_NAME_LENGTH || UNSAFE_DISPLAY_NAME_PATTERN.test(name)) {
    throw new TypeError(`Display name must be 1-${MAX_DISPLAY_NAME_LENGTH} printable characters`)
  }
  return name
}

function keyPairFromSeed (seed) {
  if (!b4a.isBuffer(seed) || seed.byteLength !== 32) throw new TypeError('Identity seed must be 32 bytes')
  return crypto.keyPair(seed)
}

function createIdentity () {
  const seed = crypto.randomBytes(32)
  return { seed, keyPair: keyPairFromSeed(seed) }
}

function userIdFromPublicKey (publicKey) {
  if (!b4a.isBuffer(publicKey) || publicKey.byteLength !== 32) throw new TypeError('Identity public key must be 32 bytes')
  return `peer_${z32.encode(publicKey)}`
}

function memberBindingBytes ({ roomId, identityPublicKey, writerKey, displayName }) {
  if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) throw new TypeError('roomId is invalid')
  if (!b4a.isBuffer(identityPublicKey) || identityPublicKey.byteLength !== 32) {
    throw new TypeError('identityPublicKey must be 32 bytes')
  }
  if (!b4a.isBuffer(writerKey) || writerKey.byteLength !== 32) throw new TypeError('writerKey must be 32 bytes')
  const name = normalizeDisplayName(displayName)
  return b4a.from(JSON.stringify([
    MEMBER_BINDING_CONTEXT,
    roomId,
    b4a.toString(identityPublicKey, 'hex'),
    b4a.toString(writerKey, 'hex'),
    name
  ]))
}

function signMemberBinding (keyPair, fields) {
  validateKeyPair(keyPair)
  return crypto.sign(memberBindingBytes(fields), keyPair.secretKey)
}

function verifyMemberBinding ({ signature, ...fields }) {
  if (!b4a.isBuffer(signature) || signature.byteLength !== 64) return false
  try {
    return crypto.verify(memberBindingBytes(fields), signature, fields.identityPublicKey)
  } catch {
    return false
  }
}

function encodeCandidateData ({ roomId, writerKey, displayName, identityKeyPair, referral = null, attemptId = null }) {
  validateKeyPair(identityKeyPair)
  if (!b4a.isBuffer(writerKey) || writerKey.byteLength !== 32) throw new TypeError('Candidate writer key must be 32 bytes')
  const name = normalizeDisplayName(displayName)
  const signature = signMemberBinding(identityKeyPair, {
    roomId,
    identityPublicKey: identityKeyPair.publicKey,
    writerKey,
    displayName: name
  })
  const normalizedReferral = referral ? validateReferral(referral) : null
  const candidate = {
    version: 1,
    roomId,
    userId: userIdFromPublicKey(identityKeyPair.publicKey),
    identityPublicKey: b4a.toString(identityKeyPair.publicKey, 'hex'),
    writerKey: b4a.toString(writerKey, 'hex'),
    displayName: name,
    signature: b4a.toString(signature, 'hex'),
    ...(attemptId ? { attemptId: validateAttemptId(attemptId) } : {}),
    referral: normalizedReferral
      ? {
          userId: normalizedReferral.userId,
          identityPublicKey: b4a.toString(normalizedReferral.identityPublicKey, 'hex'),
          signature: b4a.toString(normalizedReferral.signature, 'hex')
        }
      : null
  }
  return b4a.from(JSON.stringify(candidate))
}

function validateAttemptId (value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) {
    throw new TypeError('Candidate attempt ID is invalid')
  }
  return value
}

function validateKeyPair (keyPair) {
  if (!keyPair || !b4a.isBuffer(keyPair.publicKey) || keyPair.publicKey.byteLength !== 32 ||
      !b4a.isBuffer(keyPair.secretKey) || keyPair.secretKey.byteLength !== 64) {
    throw new TypeError('Identity key pair is invalid')
  }
  return keyPair
}

function validateReferral (referral) {
  if (!referral || typeof referral !== 'object' || Array.isArray(referral) ||
      !b4a.isBuffer(referral.identityPublicKey) || referral.identityPublicKey.byteLength !== 32 ||
      !b4a.isBuffer(referral.signature) || referral.signature.byteLength !== 64) {
    throw new TypeError('Candidate referral is invalid')
  }
  const userId = userIdFromPublicKey(referral.identityPublicKey)
  if (referral.userId !== userId) throw new TypeError('Referral user ID does not match its identity key')
  return { userId, identityPublicKey: referral.identityPublicKey, signature: referral.signature }
}

function decodeCandidateData (buffer, expectedRoomId) {
  if (!b4a.isBuffer(buffer) || buffer.byteLength < 1 || buffer.byteLength > 4096) {
    throw new TypeError('Candidate data is invalid')
  }
  let candidate
  try {
    candidate = JSON.parse(b4a.toString(buffer))
  } catch {
    throw new TypeError('Candidate data is not valid JSON')
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.version !== 1) {
    throw new TypeError('Candidate data version is unsupported')
  }
  if (typeof candidate.roomId !== 'string' || candidate.roomId !== expectedRoomId) {
    throw new TypeError('Candidate room does not match the invite')
  }
  const identityPublicKey = fromHex(candidate.identityPublicKey, 'Candidate identity key', 32)
  const writerKey = fromHex(candidate.writerKey, 'Candidate writer key', 32)
  const signature = fromHex(candidate.signature, 'Candidate identity signature', 64)
  const displayName = normalizeDisplayName(candidate.displayName)
  const userId = userIdFromPublicKey(identityPublicKey)
  if (candidate.userId !== userId) throw new TypeError('Candidate user ID does not match its identity key')
  if (!verifyMemberBinding({ roomId: expectedRoomId, identityPublicKey, writerKey, displayName, signature })) {
    throw new TypeError('Candidate identity signature is invalid')
  }
  const attemptId = candidate.attemptId === undefined ? null : validateAttemptId(candidate.attemptId)

  let referral = null
  if (candidate.referral !== null && candidate.referral !== undefined) {
    if (!candidate.referral || typeof candidate.referral !== 'object' || Array.isArray(candidate.referral)) {
      throw new TypeError('Candidate referral is invalid')
    }
    const referralIdentityPublicKey = fromHex(
      candidate.referral.identityPublicKey,
      'Referral identity key',
      32
    )
    const referralUserId = userIdFromPublicKey(referralIdentityPublicKey)
    if (candidate.referral.userId !== referralUserId) {
      throw new TypeError('Referral user ID does not match its identity key')
    }
    referral = {
      userId: referralUserId,
      identityPublicKey: referralIdentityPublicKey,
      signature: fromHex(candidate.referral.signature, 'Referral signature', 64)
    }
  }

  return { attemptId, displayName, identityPublicKey, referral, signature, userId, writerKey }
}

function fromHex (value, label, bytes) {
  if (typeof value !== 'string' || !/^[a-f0-9]+$/.test(value) || value.length !== bytes * 2) {
    throw new TypeError(`${label} is invalid`)
  }
  return b4a.from(value, 'hex')
}

module.exports = {
  MEMBER_BINDING_CONTEXT,
  ROOM_ID_PATTERN,
  createIdentity,
  decodeCandidateData,
  encodeCandidateData,
  fromHex,
  keyPairFromSeed,
  memberBindingBytes,
  normalizeDisplayName,
  signMemberBinding,
  userIdFromPublicKey,
  validateKeyPair,
  verifyMemberBinding
}
