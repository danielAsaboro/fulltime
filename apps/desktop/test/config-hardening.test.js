'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  normalizeDisplayName,
  normalizeFixtureFeedKey,
  parseRoomWorkerOptions
} = require('../lib/config.js')

test('display names normalize whitespace and compatibility characters', () => {
  assert.equal(normalizeDisplayName('  Amina   Mensah  '), 'Amina Mensah')
  assert.equal(normalizeDisplayName('\uff34\uff48\uff45\uff4f'), 'Theo')
})

test('display names reject control and bidirectional override characters', () => {
  assert.throws(() => normalizeDisplayName('Amina\u0007'), /printable characters/)
  assert.throws(() => normalizeDisplayName('Amina\u202eTheo'), /printable characters/)
  assert.throws(() => normalizeDisplayName('Amina\u2066Theo'), /printable characters/)
})

test('room workers require an exact pinned fixture publisher key', () => {
  const fixtureFeedKey = 'ab'.repeat(32)
  assert.equal(normalizeFixtureFeedKey(fixtureFeedKey), fixtureFeedKey)
  assert.throws(() => normalizeFixtureFeedKey(fixtureFeedKey.toUpperCase()), /lowercase hex/)
  assert.throws(() => parseRoomWorkerOptions([
    '--storage', '/tmp/fulltime-room',
    '--name', 'Amina'
  ]), /fixture-feed-key/)
  assert.deepEqual(parseRoomWorkerOptions([
    '--storage', '/tmp/fulltime-room',
    '--name', 'Amina',
    '--fixture-feed-key', fixtureFeedKey
  ]), {
    storagePath: '/tmp/fulltime-room',
    displayName: 'Amina',
    fixtureFeedKey
  })
  assert.deepEqual(parseRoomWorkerOptions([
    '--storage', '/tmp/fulltime-room',
    '--name', 'Amina',
    '--fixture-feed-key', fixtureFeedKey,
    '--disable-notifications'
  ]), {
    storagePath: '/tmp/fulltime-room',
    displayName: 'Amina',
    fixtureFeedKey,
    notificationsEnabled: false
  })
  assert.throws(() => parseRoomWorkerOptions([
    '--storage', '/tmp/fulltime-room',
    '--name', 'Amina',
    '--fixture-feed-key', fixtureFeedKey,
    '--disable-notifications=true'
  ]), /does not accept a value/)
})

test('answer attestor pins are all-or-nothing and stay in the Bare worker launch options', () => {
  const fixtureFeedKey = 'ab'.repeat(32)
  const servicePublicKey = 'cd'.repeat(32)
  const receiptFeedKey = 'ef'.repeat(32)
  assert.throws(() => parseRoomWorkerOptions([
    '--storage', '/tmp/fulltime-room',
    '--name', 'Amina',
    '--fixture-feed-key', fixtureFeedKey,
    '--answer-attestor-public-key', servicePublicKey
  ]), /both/)
  assert.deepEqual(parseRoomWorkerOptions([
    '--storage', '/tmp/fulltime-room',
    '--name', 'Amina',
    '--fixture-feed-key', fixtureFeedKey,
    '--answer-attestor-public-key', servicePublicKey,
    '--answer-receipt-feed-key', receiptFeedKey
  ]).answerAttestor, {
    servicePublicKey,
    receiptFeedKey
  })
})
