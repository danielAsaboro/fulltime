'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-universal')

const ACCOUNT_SEAL_CONTEXT = b4a.from('fulltime/local-account-seal/v1')
const SEALED_IDENTITY_VERSION = 2

function sealIdentitySeed (identitySeed, deviceSecret) {
  requireBytes(identitySeed, 32, 'Identity seed')
  const key = accountSealKey(deviceSecret)
  const nonce = crypto.randomBytes(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = b4a.alloc(identitySeed.byteLength + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(ciphertext, identitySeed, nonce, key)
  key.fill(0)
  return {
    version: SEALED_IDENTITY_VERSION,
    algorithm: 'xsalsa20-poly1305-v1',
    nonce: b4a.toString(nonce, 'hex'),
    ciphertext: b4a.toString(ciphertext, 'hex')
  }
}

function openIdentitySeed (record, deviceSecret) {
  validateSealedIdentity(record)
  const key = accountSealKey(deviceSecret)
  const seed = b4a.alloc(32)
  const opened = sodium.crypto_secretbox_open_easy(
    seed,
    b4a.from(record.ciphertext, 'hex'),
    b4a.from(record.nonce, 'hex'),
    key
  )
  key.fill(0)
  if (!opened) {
    seed.fill(0)
    throw new Error('The local account identity cannot be opened with this device key')
  }
  return seed
}

function validateSealedIdentity (record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.getPrototypeOf(record) !== Object.prototype) {
    throw new TypeError('Sealed account identity must be a plain object')
  }
  const expected = ['version', 'algorithm', 'nonce', 'ciphertext']
  if (Object.keys(record).length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    throw new TypeError('Sealed account identity has an invalid schema')
  }
  if (record.version !== SEALED_IDENTITY_VERSION || record.algorithm !== 'xsalsa20-poly1305-v1') {
    throw new TypeError('Sealed account identity version is unsupported')
  }
  if (typeof record.nonce !== 'string' || !/^[a-f0-9]{48}$/.test(record.nonce)) {
    throw new TypeError('Sealed account identity nonce is invalid')
  }
  if (typeof record.ciphertext !== 'string' || !/^[a-f0-9]{96}$/.test(record.ciphertext)) {
    throw new TypeError('Sealed account identity ciphertext is invalid')
  }
  return record
}

function accountSealKey (deviceSecret) {
  requireBytes(deviceSecret, 32, 'Device secret')
  const key = b4a.alloc(sodium.crypto_secretbox_KEYBYTES)
  sodium.crypto_generichash(key, ACCOUNT_SEAL_CONTEXT, deviceSecret)
  return key
}

function requireBytes (value, length, label) {
  if (!b4a.isBuffer(value) || value.byteLength !== length) throw new TypeError(`${label} is invalid`)
  return value
}

module.exports = {
  ACCOUNT_SEAL_CONTEXT,
  SEALED_IDENTITY_VERSION,
  openIdentitySeed,
  sealIdentitySeed,
  validateSealedIdentity
}
