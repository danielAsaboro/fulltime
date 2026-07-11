'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const {
  createAdmissionClaim,
  decodeAdmissionResponse,
  encodeAdmissionResponse,
  verifyAdmissionClaim
} = require('../lib/admission-claim.js')
const { createIdentity } = require('../lib/room-identity.js')
const { createOperation } = require('../lib/room-operations.js')

test('member-signed admission claims bind the invite, candidate, room, and response preview', () => {
  const member = createIdentity().keyPair
  const preview = b4a.from('{"version":2,"roomId":"room_claim_1"}')
  const candidateData = crypto.randomBytes(96)
  const fields = {
    roomId: 'room_claim_1',
    requestId: b4a.toString(crypto.randomBytes(32), 'hex'),
    inviteId: b4a.toString(crypto.randomBytes(32), 'hex'),
    receipt: b4a.toString(crypto.randomBytes(128), 'hex'),
    candidateData: b4a.toString(candidateData, 'hex'),
    issuedAt: 1_800_000_000_000
  }
  const claim = createAdmissionClaim(member, fields)
  assert.equal(verifyAdmissionClaim(claim, member.publicKey), true)
  assert.equal(verifyAdmissionClaim({ ...claim, inviteId: b4a.toString(crypto.randomBytes(32), 'hex') }, member.publicKey), false)
  assert.equal(createOperation('member.claim', claim, claim.issuedAt).type, 'member.claim')

  const response = encodeAdmissionResponse(preview, claim)
  assert.deepEqual(decodeAdmissionResponse(response, {
    preview,
    roomId: fields.roomId,
    inviteId: fields.inviteId,
    candidateData
  }), claim)
  assert.throws(() => decodeAdmissionResponse(response, {
    preview: b4a.from('different'),
    roomId: fields.roomId,
    inviteId: fields.inviteId,
    candidateData
  }), /preview/i)
})
