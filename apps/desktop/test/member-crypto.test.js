'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const {
  deriveKeyAgreementKeyPair,
  keyAgreementKeyId,
  keyAgreementKeyPairFromIdentity,
  signMemberKeyAgreement,
  verifyMemberKeyAgreement,
  openMemberSeal,
  sealToMember
} = require('../lib/member-crypto.js')

test('member key agreement is deterministic, domain-separated, and addressable', () => {
  const seed = crypto.randomBytes(32)
  const first = deriveKeyAgreementKeyPair(seed)
  const second = deriveKeyAgreementKeyPair(seed)
  assert.deepEqual(first, second)
  assert.equal(keyAgreementKeyId(first.publicKey), keyAgreementKeyId(second.publicKey))
  assert.notDeepEqual(first.publicKey, crypto.keyPair(seed).publicKey)

  const identity = crypto.keyPair(seed)
  assert.deepEqual(keyAgreementKeyPairFromIdentity(identity), first)
})

test('sealed member payloads open only for the addressed key and reject tampering', () => {
  const recipient = deriveKeyAgreementKeyPair(crypto.randomBytes(32))
  const stranger = deriveKeyAgreementKeyPair(crypto.randomBytes(32))
  const plaintext = b4a.from('epoch-key-material')
  const sealed = sealToMember(plaintext, recipient.publicKey)

  assert.deepEqual(openMemberSeal(sealed, recipient), plaintext)
  assert.throws(() => openMemberSeal(sealed, stranger), /not addressed/)

  const tampered = b4a.from(sealed)
  tampered[tampered.byteLength - 1] ^= 1
  assert.throws(() => openMemberSeal(tampered, recipient), /modified/)
})

test('member key-agreement binding is signed by the durable room identity and writer', () => {
  const seed = crypto.randomBytes(32)
  const identity = crypto.keyPair(seed)
  const agreement = keyAgreementKeyPairFromIdentity(identity)
  const fields = {
    roomId: 'room-key-binding-1',
    userId: 'peer_key_binding',
    identityPublicKey: identity.publicKey,
    writerKey: crypto.randomBytes(32),
    keyAgreementPublicKey: agreement.publicKey
  }
  const signature = signMemberKeyAgreement(identity, fields)
  assert.equal(verifyMemberKeyAgreement({ ...fields, signature }), true)
  assert.equal(verifyMemberKeyAgreement({ ...fields, writerKey: crypto.randomBytes(32), signature }), false)
})
