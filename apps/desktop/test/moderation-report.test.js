'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { deriveKeyAgreementKeyPair } = require('../lib/member-crypto.js')
const {
  createEncryptedReport,
  openEncryptedReport,
  validateEncryptedReportEnvelope
} = require('../lib/moderation-report.js')

function recipient (userId) {
  return { userId, keyPair: deriveKeyAgreementKeyPair(crypto.randomBytes(32)) }
}

test('moderation reports encrypt once and wrap their key to every canonical recipient', () => {
  const creator = recipient('peer_creator')
  const moderator = recipient('peer_moderator')
  const envelope = createEncryptedReport({
    roomId: 'room-secure-1',
    reportId: 'report-secure-1',
    reporterId: 'peer_reporter',
    target: { kind: 'item', id: 'item-offensive-1' },
    reason: 'harassment',
    note: 'Repeated abuse in the match thread.',
    createdAt: 1_700_000_000_000,
    recipients: [
      { userId: moderator.userId, publicKey: moderator.keyPair.publicKey },
      { userId: creator.userId, publicKey: creator.keyPair.publicKey }
    ]
  })

  assert.deepEqual(envelope.keyWraps.map((wrap) => wrap.userId), ['peer_creator', 'peer_moderator'])
  const openedByCreator = openEncryptedReport(envelope, {
    userId: creator.userId,
    keyPair: creator.keyPair
  })
  const openedByModerator = openEncryptedReport(envelope, {
    userId: moderator.userId,
    keyPair: moderator.keyPair
  })
  assert.deepEqual(openedByCreator, openedByModerator)
  assert.equal(openedByCreator.target.id, 'item-offensive-1')
})

test('report envelopes reject unknown recipients, modified ciphertext, and schema additions', () => {
  const creator = recipient('peer_creator')
  const stranger = recipient('peer_stranger')
  const envelope = createEncryptedReport({
    roomId: 'room-secure-1',
    reportId: 'report-secure-1',
    reporterId: 'peer_reporter',
    target: { kind: 'member', id: 'peer_abusive' },
    reason: 'spam',
    createdAt: 1,
    recipients: [{ userId: creator.userId, publicKey: creator.keyPair.publicKey }]
  })
  assert.throws(
    () => openEncryptedReport(envelope, { userId: stranger.userId, keyPair: stranger.keyPair }),
    /not addressed/
  )

  const tampered = structuredClone(envelope)
  const bytes = b4a.from(tampered.ciphertext, 'hex')
  bytes[bytes.byteLength - 1] ^= 1
  tampered.ciphertext = b4a.toString(bytes, 'hex')
  assert.throws(
    () => openEncryptedReport(tampered, { userId: creator.userId, keyPair: creator.keyPair }),
    /modified/
  )
  assert.throws(() => validateEncryptedReportEnvelope({ ...envelope, plaintext: true }), /unsupported field/)
})
