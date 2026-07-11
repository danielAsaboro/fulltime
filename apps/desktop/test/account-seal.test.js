'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { openIdentitySeed, sealIdentitySeed, validateSealedIdentity } = require('../lib/account-seal.js')

test('account identity seeds are authenticated under a device-only secret', () => {
  const seed = crypto.randomBytes(32)
  const deviceSecret = crypto.randomBytes(32)
  const sealed = sealIdentitySeed(seed, deviceSecret)

  assert.deepEqual(openIdentitySeed(sealed, deviceSecret), seed)
  assert.equal(Object.hasOwn(sealed, 'seed'), false)
  assert.throws(() => openIdentitySeed(sealed, crypto.randomBytes(32)), /cannot be opened/)

  const tampered = structuredClone(sealed)
  const bytes = b4a.from(tampered.ciphertext, 'hex')
  bytes[0] ^= 1
  tampered.ciphertext = b4a.toString(bytes, 'hex')
  assert.throws(() => openIdentitySeed(tampered, deviceSecret), /cannot be opened/)
})

test('sealed account records have a closed schema', () => {
  const sealed = sealIdentitySeed(crypto.randomBytes(32), crypto.randomBytes(32))
  assert.equal(validateSealedIdentity(sealed), sealed)
  assert.throws(() => validateSealedIdentity({ ...sealed, seed: 'a'.repeat(64) }), /schema/)
})
