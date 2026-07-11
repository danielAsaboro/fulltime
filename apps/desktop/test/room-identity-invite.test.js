'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const crypto = require('hypercore-crypto')
const z32 = require('z32')

const {
  createIdentity,
  decodeCandidateData,
  encodeCandidateData,
  normalizeDisplayName,
  userIdFromPublicKey
} = require('../lib/room-identity.js')
const {
  addReferral,
  encodeBaseInvite,
  parseInviteCode,
  previewBytes,
  referralBytes
} = require('../lib/invite-code.js')

const FIXTURE = Object.freeze({
  id: 'fixture-9001',
  competition: 'World Cup',
  home: { id: 'fra', name: 'France' },
  away: { id: 'mar', name: 'Morocco' },
  kickoff: 1_700_000_000_000,
  status: 'scheduled'
})

test('candidate data binds the stable identity, room, writer, and normalized name', () => {
  const { keyPair } = createIdentity()
  const writerKey = crypto.randomBytes(32)
  const encoded = encodeCandidateData({
    roomId: 'room-secure-1',
    writerKey,
    displayName: '  Ada   Fan  ',
    identityKeyPair: keyPair
  })

  const decoded = decodeCandidateData(encoded, 'room-secure-1')
  assert.equal(decoded.displayName, 'Ada Fan')
  assert.equal(decoded.userId, userIdFromPublicKey(keyPair.publicKey))
  assert.ok(b4a.equals(decoded.writerKey, writerKey))

  const tampered = JSON.parse(b4a.toString(encoded))
  tampered.displayName = 'Mallory'
  assert.throws(
    () => decodeCandidateData(b4a.from(JSON.stringify(tampered)), 'room-secure-1'),
    /signature is invalid/
  )
  assert.throws(() => decodeCandidateData(encoded, 'room-other-1'), /does not match/)
})

test('identity helpers reject path-like room IDs and malformed referral identities', () => {
  const { keyPair } = createIdentity()
  assert.equal(normalizeDisplayName(' One\nFan '), 'One Fan')
  assert.equal(normalizeDisplayName('\uff34\uff48\uff45\uff4f'), 'Theo')
  assert.throws(() => normalizeDisplayName('Ada\u202eMallory'), /printable characters/)
  assert.throws(() => encodeCandidateData({
    roomId: '../room',
    writerKey: crypto.randomBytes(32),
    displayName: 'Fan',
    identityKeyPair: keyPair
  }), /roomId is invalid/)
  assert.throws(() => encodeCandidateData({
    roomId: 'room-safe-1',
    writerKey: crypto.randomBytes(32),
    displayName: 'Fan',
    identityKeyPair: keyPair,
    referral: {
      userId: 'peer_wrong',
      identityPublicKey: crypto.randomBytes(32),
      signature: crypto.randomBytes(64)
    }
  }), /Referral user ID/)
})

test('invite code verifies signed canonical preview, expiry, and signed referrals', () => {
  const now = 1_700_000_000_000
  const expires = now + 60_000
  const preview = {
    roomId: 'room-secure-1',
    roomName: 'France v Morocco',
    fixture: FIXTURE,
    memberCount: 1,
    createdBy: 'peer_creator',
    createdAt: now - 1_000
  }
  const encodedPreview = previewBytes(preview)
  const created = BlindPairing.createInvite(crypto.randomBytes(32), {
    data: encodedPreview,
    expires
  })
  const code = encodeBaseInvite({
    invite: created.invite,
    preview: created.additional.data,
    signature: created.additional.signature
  })

  const parsed = parseInviteCode(code, { now })
  assert.equal(parsed.baseCode, code)
  assert.equal(parsed.preview.roomId, preview.roomId)
  assert.equal(parsed.preview.createdBy, preview.createdBy)
  assert.equal(parsed.preview.createdAt, preview.createdAt)
  assert.equal(parsed.expiresAt, expires)
  assert.ok(b4a.equals(parsed.invitePublicKey, created.publicKey))
  assert.ok(b4a.equals(parsed.discoveryKey, created.discoveryKey))

  const referrer = createIdentity().keyPair
  const referredCode = addReferral(code, referrer, { now })
  const referred = parseInviteCode(referredCode, { now })
  assert.equal(referred.referral.userId, userIdFromPublicKey(referrer.publicKey))
  assert.ok(crypto.verify(referralBytes(code), referred.referral.signature, referrer.publicKey))

  assert.throws(() => parseInviteCode(code, { now: expires }), /expired/)
  assert.equal(parseInviteCode(code, { allowExpired: true, now: expires }).preview.roomId, preview.roomId)
})

test('invite parser rejects noncanonical previews and invites without discovery data', () => {
  const canonical = {
    version: 2,
    roomId: 'room-secure-1',
    roomName: 'France v Morocco',
    fixture: FIXTURE,
    memberCount: 1,
    createdBy: 'peer_creator',
    createdAt: 1_700_000_000_000
  }
  const noncanonical = b4a.from(JSON.stringify({ ...canonical, injected: true }))
  const created = BlindPairing.createInvite(crypto.randomBytes(32), { data: noncanonical })
  const code = [
    'ft2',
    z32.encode(created.invite),
    z32.encode(created.additional.data),
    z32.encode(created.additional.signature)
  ].join('.')
  assert.throws(() => parseInviteCode(code), /not canonical/)

  const encodedPreview = previewBytes(canonical)
  const noDiscovery = BlindPairing.createInvite(crypto.randomBytes(32), {
    data: encodedPreview,
    discoveryKey: null
  })
  const noDiscoveryCode = [
    'ft2',
    z32.encode(noDiscovery.invite),
    z32.encode(noDiscovery.additional.data),
    z32.encode(noDiscovery.additional.signature)
  ].join('.')
  assert.throws(() => parseInviteCode(noDiscoveryCode), /missing room discovery data/)
})
