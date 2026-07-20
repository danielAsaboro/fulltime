'use strict'

const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const crypto = require('hypercore-crypto')
const z32 = require('z32')

const { userIdFromPublicKey } = require('./room-identity.js')
const {
  MAX_INVITE_CODE_LENGTH,
  MAX_INVITE_PREVIEW_BYTES,
  MAX_ROOM_MEMBERS,
  MAX_ROOM_NAME_LENGTH
} = require('./room-constants.js')

const INVITE_PREFIX = 'ft2'
const INVITE_PREVIEW_VERSION = 2
const REFERRAL_CONTEXT = 'fulltime/invite-referral/v1'
const FIXTURE_STATUSES = new Set([
  'scheduled',
  'delayed',
  'postponed',
  'first-half',
  'half-time',
  'second-half',
  'end-of-regulation',
  'extra-time',
  'penalty-shootout',
  'full-time',
  'after-extra-time',
  'after-penalties',
  'abandoned',
  'cancelled',
  'unknown'
])

function asBuffer (value, label, bytes) {
  if (!b4a.isBuffer(value) || (bytes && value.byteLength !== bytes)) {
    throw new TypeError(`${label} must be${bytes ? ` ${bytes}-byte` : ''} binary data`)
  }
  return value
}

function previewBytes (preview) {
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    throw new TypeError('Invite preview must be an object')
  }
  const value = {
    version: INVITE_PREVIEW_VERSION,
    roomId: preview.roomId,
    roomName: typeof preview.roomName === 'string' ? preview.roomName.trim() : preview.roomName,
    fixture: preview.fixture,
    memberCount: preview.memberCount,
    createdBy: preview.createdBy,
    createdAt: preview.createdAt
  }
  safeText(value.roomId, 'Invite preview roomId', 180)
  safeText(value.roomName, 'Invite preview roomName', MAX_ROOM_NAME_LENGTH)
  validateFixturePreview(value.fixture)
  if (!Number.isSafeInteger(value.memberCount) || value.memberCount < 1 || value.memberCount > MAX_ROOM_MEMBERS) {
    throw new TypeError('Invite preview memberCount is invalid')
  }
  safeText(value.createdBy, 'Invite preview createdBy', 180)
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw new TypeError('Invite preview createdAt is invalid')
  }
  let encoded
  try {
    encoded = b4a.from(JSON.stringify(value))
  } catch {
    throw new TypeError('Invite preview is not JSON encodable')
  }
  if (encoded.byteLength > MAX_INVITE_PREVIEW_BYTES) throw new TypeError('Invite preview is too large')
  return encoded
}

function encodeBaseInvite ({ invite, preview, signature }) {
  const inviteBuffer = asBuffer(invite, 'Blind-pairing invite')
  const encodedPreview = b4a.isBuffer(preview) ? preview : previewBytes(preview)
  const signatureBuffer = asBuffer(signature, 'Invite preview signature', 64)
  const code = [INVITE_PREFIX, z32.encode(inviteBuffer), z32.encode(encodedPreview), z32.encode(signatureBuffer)].join('.')
  parseInviteCode(code, { allowExpired: true })
  return code
}

function referralBytes (baseCode) {
  return b4a.from(JSON.stringify([REFERRAL_CONTEXT, baseCode]))
}

function addReferral (baseCode, identityKeyPair, options) {
  const parsed = parseInviteCode(baseCode, options)
  if (!identityKeyPair || !b4a.isBuffer(identityKeyPair.publicKey) || identityKeyPair.publicKey.byteLength !== 32 ||
      !b4a.isBuffer(identityKeyPair.secretKey) || identityKeyPair.secretKey.byteLength !== 64) {
    throw new TypeError('Referral identity key pair is invalid')
  }
  const signature = crypto.sign(referralBytes(parsed.baseCode), identityKeyPair.secretKey)
  return `${parsed.baseCode}.r.${z32.encode(identityKeyPair.publicKey)}.${z32.encode(signature)}`
}

function parseInviteCode (value, { allowExpired = false, now = Date.now() } = {}) {
  if (typeof value !== 'string') throw new TypeError('Invite code must be a string')
  const code = value.trim()
  if (!code || code.length > MAX_INVITE_CODE_LENGTH) throw new TypeError('Invite code is malformed')
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invite validation time is invalid')
  const parts = code.split('.')
  if (parts.length !== 4 && parts.length !== 7) throw new TypeError('Invite code is malformed')
  if (parts[0] !== INVITE_PREFIX) throw new TypeError('Invite version is unsupported')
  if (parts.length === 7 && parts[4] !== 'r') throw new TypeError('Invite referral is malformed')

  let invite
  let encodedPreview
  let previewSignature
  try {
    invite = z32.decode(parts[1])
    encodedPreview = z32.decode(parts[2])
    previewSignature = z32.decode(parts[3])
  } catch {
    throw new TypeError('Invite code contains invalid z32 data')
  }
  asBuffer(previewSignature, 'Invite preview signature', 64)

  let decoded
  try {
    decoded = BlindPairing.decodeInvite(invite)
  } catch {
    throw new TypeError('Blind-pairing invite is invalid')
  }
  if (!b4a.isBuffer(decoded.seed) || decoded.seed.byteLength !== 32 ||
      !b4a.isBuffer(decoded.discoveryKey) || decoded.discoveryKey.byteLength !== 32) {
    throw new TypeError('Blind-pairing invite is missing room discovery data')
  }
  const inviteKeyPair = crypto.keyPair(decoded.seed)
  if (!crypto.verify(encodedPreview, previewSignature, inviteKeyPair.publicKey)) {
    throw new TypeError('Invite preview signature is invalid')
  }

  let preview
  try {
    preview = JSON.parse(b4a.toString(encodedPreview))
  } catch {
    throw new TypeError('Invite preview is invalid')
  }
  const canonicalPreview = previewBytes(preview)
  if (!b4a.equals(encodedPreview, canonicalPreview)) throw new TypeError('Invite preview is not canonical')
  preview = JSON.parse(b4a.toString(canonicalPreview))
  if (!allowExpired && decoded.expires && decoded.expires <= now) throw new TypeError('Invite has expired')

  const baseCode = parts.slice(0, 4).join('.')
  let referral = null
  if (parts.length === 7) {
    let identityPublicKey
    let signature
    try {
      identityPublicKey = z32.decode(parts[5])
      signature = z32.decode(parts[6])
    } catch {
      throw new TypeError('Invite referral contains invalid z32 data')
    }
    asBuffer(identityPublicKey, 'Referral identity public key', 32)
    asBuffer(signature, 'Referral signature', 64)
    if (!crypto.verify(referralBytes(baseCode), signature, identityPublicKey)) {
      throw new TypeError('Invite referral signature is invalid')
    }
    referral = {
      identityPublicKey,
      userId: userIdFromPublicKey(identityPublicKey),
      signature
    }
  }

  return {
    baseCode,
    blindInvite: invite,
    blindInviteId: decoded.id,
    discoveryKey: decoded.discoveryKey,
    expiresAt: decoded.expires || null,
    invitePublicKey: inviteKeyPair.publicKey,
    preview,
    previewBytes: encodedPreview,
    previewSignature,
    referral
  }
}

function validateFixturePreview (fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture) || Object.getPrototypeOf(fixture) !== Object.prototype) {
    throw new TypeError('Invite preview fixture is required')
  }
  safeText(fixture.id, 'Fixture ID', 180)
  safeText(fixture.competition, 'Fixture competition', 160)
  validateTeam(fixture.home, 'home')
  validateTeam(fixture.away, 'away')
  if (!Number.isSafeInteger(fixture.kickoff) || fixture.kickoff < 0) throw new TypeError('Fixture kickoff is invalid')
  if (!FIXTURE_STATUSES.has(fixture.status)) throw new TypeError('Fixture status is invalid')
  if (fixture.minute !== undefined && fixture.minute !== null &&
      (!Number.isSafeInteger(fixture.minute) || fixture.minute < 0 || fixture.minute > 300)) {
    throw new TypeError('Fixture minute is invalid')
  }
  if (fixture.score !== undefined) validateScore(fixture.score)
  return fixture
}

function validateTeam (team, side) {
  if (!team || typeof team !== 'object' || Array.isArray(team) || Object.getPrototypeOf(team) !== Object.prototype) {
    throw new TypeError(`Fixture ${side} team is invalid`)
  }
  safeText(team.id, `Fixture ${side} team ID`, 180)
  safeText(team.name, `Fixture ${side} team name`, 120)
  if (team.shortName !== undefined) safeText(team.shortName, `Fixture ${side} short name`, 40)
  if (team.country !== undefined) safeText(team.country, `Fixture ${side} country`, 40)
}

function validateScore (score) {
  if (!score || typeof score !== 'object' || Array.isArray(score) || Object.getPrototypeOf(score) !== Object.prototype) {
    throw new TypeError('Fixture score is invalid')
  }
  scoreNumber(score.home, 'Fixture home score')
  scoreNumber(score.away, 'Fixture away score')
  if (score.penaltiesHome !== undefined) scoreNumber(score.penaltiesHome, 'Fixture home penalties')
  if (score.penaltiesAway !== undefined) scoreNumber(score.penaltiesAway, 'Fixture away penalties')
}

function scoreNumber (value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 99) throw new TypeError(`${label} is invalid`)
}

function safeText (value, label, maximum) {
  if (typeof value !== 'string') throw new TypeError(`${label} is required`)
  const text = value.trim()
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError(`${label} is invalid`)
  }
  return text
}

module.exports = {
  INVITE_PREFIX,
  INVITE_PREVIEW_VERSION,
  REFERRAL_CONTEXT,
  addReferral,
  encodeBaseInvite,
  parseInviteCode,
  previewBytes,
  referralBytes,
  validateFixturePreview
}
