'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { createIdentity, signMemberBinding, userIdFromPublicKey } = require('../lib/room-identity.js')
const { createOperation, validateRoomOperation } = require('../lib/room-operations.js')

const FIXTURE = {
  id: 'fixture-9001',
  competition: 'World Cup',
  home: { id: 'fra', name: 'France' },
  away: { id: 'mar', name: 'Morocco' },
  kickoff: 1_700_000_000_000,
  status: 'scheduled'
}

test('room genesis validates a signed creator binding and complete fixture', () => {
  const { keyPair } = createIdentity()
  const writerKey = crypto.randomBytes(32)
  const signature = signMemberBinding(keyPair, {
    roomId: 'room-ops-1',
    identityPublicKey: keyPair.publicKey,
    writerKey,
    displayName: 'Ada'
  })
  const operation = createOperation('room.create', {
    roomId: 'room-ops-1',
    type: 'private',
    name: 'France v Morocco',
    fixture: FIXTURE,
    creator: {
      userId: userIdFromPublicKey(keyPair.publicKey),
      displayName: 'Ada',
      identityPublicKey: b4a.toString(keyPair.publicKey, 'hex'),
      writerKey: b4a.toString(writerKey, 'hex'),
      signature: b4a.toString(signature, 'hex')
    }
  }, 1_700_000_000_000)
  assert.equal(validateRoomOperation(operation), operation)

  const malformed = structuredClone(operation)
  delete malformed.payload.fixture.status
  assert.throws(() => validateRoomOperation(malformed), /Fixture status/)
})

test('text, authenticated media descriptors, polls, reactions, and admission limits are enforced', () => {
  assert.throws(
    () => createOperation('message.add', { id: 'item-long-1', messageId: 'message-long-1', text: 'x'.repeat(1001) }),
    /1-1000/
  )
  assert.throws(
    () => createOperation('message.add', { id: 'item-nul-1', messageId: 'message-nul-1', text: 'bad\u0000text' }),
    /1-1000/
  )

  const attachment = {
    version: 1,
    epoch: 1,
    mediaId: 'media-attachment-1',
    authorId: 'peer_attachment_author',
    coreKey: 'a'.repeat(64),
    blob: { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 1040 },
    encryption: {
      algorithm: 'xsalsa20-poly1305-chunked-v1',
      noncePrefix: 'b'.repeat(32),
      plaintextChunkBytes: 65536
    },
    plaintextHash: 'c'.repeat(64),
    hashAlgorithm: 'blake2b-256',
    mimeType: 'image/png',
    name: 'goal.png',
    sizeBytes: 1024,
    width: 1,
    height: 1
  }
  assert.equal(createOperation('message.add', {
    id: 'item-attachment-1',
    messageId: 'message-attachment-1',
    text: 'Goal',
    attachment
  }).payload.attachment.mediaId, attachment.mediaId)
  assert.throws(() => createOperation('message.add', {
    id: 'item-attachment-invalid-1',
    messageId: 'message-attachment-invalid-1',
    text: '',
    attachment: { ...attachment, url: `pear-blob://${'a'.repeat(64)}` }
  }), /unsupported/)
  assert.equal(createOperation('member.media-core', {
    epoch: 1,
    coreKey: 'd'.repeat(64)
  }).type, 'member.media-core')
  assert.throws(() => createOperation('message.add', {
    id: 'item-empty-1',
    messageId: 'message-empty-1'
  }), /Message must be/)

  assert.throws(() => createOperation('poll.create', {
    id: 'item-poll-1',
    pollId: 'poll-1',
    question: 'Who scores next?',
    options: [
      { id: 'option-same', label: 'France' },
      { id: 'option-same', label: 'Morocco' }
    ]
  }), /IDs must be unique/)
  assert.throws(() => createOperation('poll.create', {
    id: 'item-poll-2',
    pollId: 'poll-2',
    question: 'Who scores next?',
    options: [
      { id: 'option-fra', label: 'France' },
      { id: 'option-mar', label: ' france ' }
    ]
  }), /options must be unique/)

  assert.equal(createOperation('reaction.add', { itemId: 'item-text-1', emoji: '🔥' }).type, 'reaction.add')
  assert.throws(
    () => createOperation('reaction.add', { itemId: 'item-text-1', emoji: 'not-an-emoji' }),
    /unsupported/
  )
  assert.throws(() => createOperation('member.admit', {
    requestId: 'short',
    inviteId: 'also-short',
    receipt: 'aa',
    candidateData: 'aa'
  }), /request ID/)
})

test('invite operation requires binary identifiers and a future expiry', () => {
  const base = {
    id: 'a'.repeat(64),
    code: `ft1.${'y'.repeat(12)}.${'y'.repeat(12)}.${'y'.repeat(12)}`,
    publicKey: 'b'.repeat(64),
    preview: 'aa',
    previewSignature: 'c'.repeat(128),
    createdAt: 1000,
    expiresAt: 2000
  }
  assert.equal(createOperation('invite.create', base, 1000).payload.id, base.id)
  assert.throws(() => createOperation('invite.create', { ...base, id: 'invite-friendly-id' }, 1000), /Invite ID/)
  assert.throws(() => createOperation('invite.create', { ...base, expiresAt: 1000 }, 1000), /after creation/)
})

test('member rename operations accept only a normalized closed payload', () => {
  assert.equal(createOperation('member.rename', { displayName: 'Ada Lovelace' }).payload.displayName, 'Ada Lovelace')
  assert.throws(() => createOperation('member.rename', { displayName: '  Ada  ' }), /normalized/)
  assert.throws(() => createOperation('member.rename', { displayName: 'Ada', userId: 'someone-else' }), /unsupported/)
})

test('answer references are closed, receipt-index bound, and never carry a token body', () => {
  const serviceKey = 'a'.repeat(64)
  const reference = {
    receiptId: `aat:${serviceKey}:7`,
    tokenId: `aat:${serviceKey}:7`,
    receiptFeedKey: 'b'.repeat(64),
    receiptIndex: 7,
    userId: 'peer_answer_writer',
    answerId: 'answer:room:0007',
    callId: 'call:fixture:0007',
    optionId: 'yes'
  }
  assert.equal(createOperation('answer.reference', reference).type, 'answer.reference')
  assert.throws(
    () => createOperation('answer.reference', { ...reference, receiptIndex: 8 }),
    /token ID/
  )
  assert.throws(
    () => createOperation('answer.reference', { ...reference, token: { forged: true } }),
    /unsupported/
  )
})
