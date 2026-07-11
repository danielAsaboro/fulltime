'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-universal')

const KEY_AGREEMENT_DERIVE_CONTEXT = b4a.from('fulltime/member-key-agreement/derive/v1')
const KEY_AGREEMENT_ID_CONTEXT = b4a.from('fulltime/member-key-agreement/id/v1')
const KEY_AGREEMENT_BINDING_CONTEXT = 'fulltime/member-key-agreement/binding/v1'
const MAX_SEALED_PLAINTEXT_BYTES = 64 * 1024
const ROOM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/
const MEMBER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,179}$/

function deriveKeyAgreementKeyPair (identitySeed) {
  requireBuffer(identitySeed, 32, 'Identity seed')
  const seed = b4a.alloc(sodium.crypto_box_SEEDBYTES)
  sodium.crypto_generichash(seed, b4a.concat([KEY_AGREEMENT_DERIVE_CONTEXT, identitySeed]))
  const publicKey = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  const secretKey = b4a.alloc(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_box_seed_keypair(publicKey, secretKey, seed)
  seed.fill(0)
  return { publicKey, secretKey }
}

function keyAgreementKeyPairFromIdentity (identityKeyPair) {
  if (!identityKeyPair || !b4a.isBuffer(identityKeyPair.secretKey) || identityKeyPair.secretKey.byteLength !== 64) {
    throw new TypeError('Identity key pair is invalid')
  }
  // hypercore-crypto Ed25519 secret keys contain the original 32-byte seed in
  // their first half.  Domain separation above ensures the Curve25519 secret is
  // a distinct key even though both are recoverable from the account seed.
  return deriveKeyAgreementKeyPair(identityKeyPair.secretKey.subarray(0, 32))
}

function keyAgreementKeyId (publicKey) {
  requireBuffer(publicKey, sodium.crypto_box_PUBLICKEYBYTES, 'Key-agreement public key')
  const digest = b4a.alloc(32)
  sodium.crypto_generichash(digest, b4a.concat([KEY_AGREEMENT_ID_CONTEXT, publicKey]))
  return b4a.toString(digest, 'hex')
}

function memberKeyAgreementBindingBytes ({ roomId, userId, identityPublicKey, writerKey, keyAgreementPublicKey }) {
  if (typeof roomId !== 'string' || !ROOM_ID.test(roomId)) throw new TypeError('Room ID is invalid')
  if (typeof userId !== 'string' || !MEMBER_ID.test(userId)) throw new TypeError('Member ID is invalid')
  requireBuffer(identityPublicKey, 32, 'Member identity public key')
  requireBuffer(writerKey, 32, 'Member writer key')
  requireBuffer(keyAgreementPublicKey, sodium.crypto_box_PUBLICKEYBYTES, 'Member key-agreement public key')
  return b4a.from(JSON.stringify([
    KEY_AGREEMENT_BINDING_CONTEXT,
    roomId,
    userId,
    b4a.toString(identityPublicKey, 'hex'),
    b4a.toString(writerKey, 'hex'),
    b4a.toString(keyAgreementPublicKey, 'hex')
  ]))
}

function signMemberKeyAgreement (identityKeyPair, fields) {
  validateIdentityKeyPair(identityKeyPair)
  return crypto.sign(memberKeyAgreementBindingBytes(fields), identityKeyPair.secretKey)
}

function verifyMemberKeyAgreement ({ signature, identityPublicKey, ...fields }) {
  if (!b4a.isBuffer(signature) || signature.byteLength !== 64) return false
  try {
    requireBuffer(identityPublicKey, 32, 'Member identity public key')
    return crypto.verify(memberKeyAgreementBindingBytes({ ...fields, identityPublicKey }), signature, identityPublicKey)
  } catch {
    return false
  }
}

function sealToMember (plaintext, recipientPublicKey) {
  requireBuffer(plaintext, null, 'Sealed plaintext')
  requireBuffer(recipientPublicKey, sodium.crypto_box_PUBLICKEYBYTES, 'Recipient key-agreement public key')
  if (plaintext.byteLength > MAX_SEALED_PLAINTEXT_BYTES) {
    throw new TypeError(`Sealed plaintext may not exceed ${MAX_SEALED_PLAINTEXT_BYTES} bytes`)
  }
  const ciphertext = b4a.alloc(plaintext.byteLength + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(ciphertext, plaintext, recipientPublicKey)
  return ciphertext
}

function openMemberSeal (ciphertext, keyPair) {
  requireBuffer(ciphertext, null, 'Sealed ciphertext')
  validateAgreementKeyPair(keyPair)
  if (ciphertext.byteLength < sodium.crypto_box_SEALBYTES ||
      ciphertext.byteLength > MAX_SEALED_PLAINTEXT_BYTES + sodium.crypto_box_SEALBYTES) {
    throw new TypeError('Sealed ciphertext size is invalid')
  }
  const plaintext = b4a.alloc(ciphertext.byteLength - sodium.crypto_box_SEALBYTES)
  if (!sodium.crypto_box_seal_open(plaintext, ciphertext, keyPair.publicKey, keyPair.secretKey)) {
    plaintext.fill(0)
    throw new Error('Sealed ciphertext is not addressed to this member or was modified')
  }
  return plaintext
}

function validateAgreementKeyPair (keyPair) {
  if (!keyPair || !b4a.isBuffer(keyPair.publicKey) ||
      keyPair.publicKey.byteLength !== sodium.crypto_box_PUBLICKEYBYTES ||
      !b4a.isBuffer(keyPair.secretKey) ||
      keyPair.secretKey.byteLength !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new TypeError('Key-agreement key pair is invalid')
  }
  const derived = b4a.alloc(sodium.crypto_scalarmult_BYTES)
  sodium.crypto_scalarmult_base(derived, keyPair.secretKey)
  if (!b4a.equals(derived, keyPair.publicKey)) throw new TypeError('Key-agreement key pair does not match')
  return keyPair
}

function validateIdentityKeyPair (keyPair) {
  if (!keyPair || !b4a.isBuffer(keyPair.publicKey) || keyPair.publicKey.byteLength !== 32 ||
      !b4a.isBuffer(keyPair.secretKey) || keyPair.secretKey.byteLength !== 64) {
    throw new TypeError('Identity key pair is invalid')
  }
  return keyPair
}

function requireBuffer (value, expectedBytes, label) {
  if (!b4a.isBuffer(value) || (expectedBytes !== null && value.byteLength !== expectedBytes)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

module.exports = {
  KEY_AGREEMENT_DERIVE_CONTEXT,
  KEY_AGREEMENT_BINDING_CONTEXT,
  MAX_SEALED_PLAINTEXT_BYTES,
  deriveKeyAgreementKeyPair,
  keyAgreementKeyId,
  keyAgreementKeyPairFromIdentity,
  memberKeyAgreementBindingBytes,
  openMemberSeal,
  sealToMember,
  signMemberKeyAgreement,
  validateAgreementKeyPair,
  verifyMemberKeyAgreement
}
