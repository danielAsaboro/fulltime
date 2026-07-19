'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const { createReceipt } = require('blind-pairing-core')
const crypto = require('hypercore-crypto')

const { encodeBaseInvite, previewBytes } = require('../lib/invite-code.js')
const {
  createIdentity,
  encodeCandidateData,
  signMemberBinding,
  userIdFromPublicKey
} = require('../lib/room-identity.js')
const { keyAgreementKeyPairFromIdentity, signMemberKeyAgreement } = require('../lib/member-crypto.js')
const { createEncryptedReport, openEncryptedReport } = require('../lib/moderation-report.js')
const { createOperation } = require('../lib/room-operations.js')
const { MAX_ROOM_MEMBERS } = require('../lib/room-constants.js')
const { encodeRoomFrame, ROOM_IPC_VERSION } = require('../lib/room-protocol.js')
const { applyRoomNodes, projectRoom, valueAt } = require('../workers/room-view.js')

const NOW = 1_700_000_000_000
const FIXTURE = {
  id: 'fixture-9001',
  competition: 'World Cup',
  home: { id: 'fra', name: 'France' },
  away: { id: 'mar', name: 'Morocco' },
  kickoff: NOW + 3_600_000,
  status: 'scheduled'
}

test('deterministic room view authenticates invites/admissions and materializes bounded social state', async () => {
  const view = new MemoryView()
  const host = new MemoryHost()
  const creator = createIdentity().keyPair
  const creatorWriter = crypto.randomBytes(32)
  await apply(view, host, creatorWriter, genesisOperation(creator, creatorWriter))

  const room = await valueAt(view, 'meta/room')
  assert.equal(room.memberCount, 1)

  const inviteTime = NOW + 1000
  const invitePreview = previewBytes({
    roomId: room.id,
    roomName: room.name,
    fixture: room.fixture,
    memberCount: room.memberCount,
    createdBy: room.createdBy,
    createdAt: room.createdAt
  })
  const blindInvite = BlindPairing.createInvite(crypto.randomBytes(32), {
    data: invitePreview,
    expires: NOW + 60_000
  })
  host.discoveryKey = blindInvite.discoveryKey
  const inviteCode = encodeBaseInvite({
    invite: blindInvite.invite,
    preview: blindInvite.additional.data,
    signature: blindInvite.additional.signature
  })
  const invitePayload = {
    id: b4a.toString(blindInvite.id, 'hex'),
    code: inviteCode,
    publicKey: b4a.toString(blindInvite.publicKey, 'hex'),
    preview: b4a.toString(blindInvite.additional.data, 'hex'),
    previewSignature: b4a.toString(blindInvite.additional.signature, 'hex'),
    createdAt: inviteTime,
    expiresAt: blindInvite.expires
  }

  const forgedInvite = createOperation('invite.create', {
    ...invitePayload,
    publicKey: b4a.toString(crypto.randomBytes(32), 'hex')
  }, inviteTime)
  await apply(view, host, creatorWriter, forgedInvite)
  assert.equal((await valueAt(view, `operation/${forgedInvite.id}`)).applied, false)
  assert.equal((await valueAt(view, 'meta/room')).activeInviteId, null)

  const inviteOperation = createOperation('invite.create', invitePayload, inviteTime)
  await apply(view, host, creatorWriter, inviteOperation)
  assert.equal((await valueAt(view, `operation/${inviteOperation.id}`)).applied, true)

  const joiner = createIdentity().keyPair
  const joinerWriter = crypto.randomBytes(32)
  const candidateData = encodeCandidateData({
    roomId: room.id,
    writerKey: joinerWriter,
    displayName: 'Grace',
    identityKeyPair: joiner
  })
  const { receipt } = createReceipt(blindInvite.invite, candidateData)
  const admission = createOperation('member.admit', {
    requestId: b4a.toString(crypto.randomBytes(32), 'hex'),
    inviteId: invitePayload.id,
    receipt: b4a.toString(receipt, 'hex'),
    candidateData: b4a.toString(candidateData, 'hex')
  }, inviteTime + 1)
  await apply(view, host, creatorWriter, admission)

  assert.equal((await valueAt(view, `operation/${admission.id}`)).applied, true)
  assert.deepEqual(host.added.map(({ options }) => options), [{ indexer: true }])
  assert.equal((await valueAt(view, 'meta/room')).memberCount, 2)
  assert.equal((await valueAt(view, `member/${userIdFromPublicKey(joiner.publicKey)}`)).role, 'member')

  const message = createOperation('message.add', {
    id: 'item-message-1',
    messageId: 'message-1',
    text: 'Goal!'
  }, inviteTime + 2)
  await apply(view, host, joinerWriter, message)
  const memberRename = createOperation('member.rename', { displayName: 'Grace Hopper' }, inviteTime + 3)
  await apply(view, host, joinerWriter, memberRename)
  assert.equal((await valueAt(view, `operation/${memberRename.id}`)).applied, true)
  const reply = createOperation('reply.add', {
    id: 'reply-message-1',
    itemId: 'item-message-1',
    text: 'What a finish'
  }, inviteTime + 4)
  await apply(view, host, creatorWriter, reply)
  const duplicateReply = createOperation('reply.add', {
    id: 'reply-message-1',
    itemId: 'item-message-1',
    text: 'Duplicate ID'
  }, inviteTime + 5)
  await apply(view, host, creatorWriter, duplicateReply)
  assert.equal((await valueAt(view, `operation/${duplicateReply.id}`)).applied, false)

  await apply(view, host, creatorWriter, createOperation('reaction.add', {
    itemId: 'item-message-1',
    emoji: '🔥'
  }, inviteTime + 6))

  const quoteMessage = createOperation('message.add', {
    id: 'item-quote-1',
    messageId: 'message-quote-1',
    text: 'You really called it.',
    quotedItemId: 'item-message-1'
  }, inviteTime + 7)
  await apply(view, host, creatorWriter, quoteMessage)

  const fiveOptionPoll = createOperation('poll.create', {
    id: 'item-market-poll-1',
    pollId: 'poll-market-1',
    question: 'How many total goals?',
    options: ['0', '1', '2', '3', '4+'].map((label, index) => ({ id: `option-goals-${index}`, label }))
  }, inviteTime + 7)
  await apply(view, host, creatorWriter, fiveOptionPoll)
  const marketReference = {
    pollId: 'poll-market-1',
    network: 'devnet',
    program: '8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw',
    mint: 'ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh',
    market: '11111111111111111111111111111111',
    fixtureId: 'fixture-9001',
    rulebookHash: 'a'.repeat(64),
    creationSignature: '2'.repeat(88)
  }
  const forgedReference = createOperation('market.reference', marketReference, inviteTime + 8)
  await apply(view, host, joinerWriter, forgedReference)
  assert.equal((await valueAt(view, `operation/${forgedReference.id}`)).applied, false)
  const authoredReference = createOperation('market.reference', marketReference, inviteTime + 9)
  await apply(view, host, creatorWriter, authoredReference)
  assert.equal((await valueAt(view, `operation/${authoredReference.id}`)).applied, true)

  const projection = await projectRoom(view, {
    identityKeyPair: creator,
    personal: {},
    presence: new Map([[userIdFromPublicKey(joiner.publicKey), { typing: true }]])
  })
  const projectedMessage = projection.state.items.find((item) => item.id === 'item-message-1')
  assert.equal(projectedMessage.replyCount, 1)
  assert.equal(projectedMessage.replies.length, 1)
  assert.deepEqual(projectedMessage.reactions, [{ emoji: '🔥', count: 1, reactedByMe: true }])
  assert.equal(projectedMessage.author.displayName, 'Grace Hopper')
  const projectedQuote = projection.state.items.find((item) => item.id === 'item-quote-1')
  assert.equal(projectedQuote.quote.itemId, 'item-message-1')
  assert.equal(projectedQuote.quote.text, 'Goal!')
  assert.equal(projectedQuote.quote.author.displayName, 'Grace Hopper')
  assert.equal(projectedQuote.quote.author.isCurrentUser, false)
  const projectedPoll = projection.state.items.find((item) => item.id === 'item-market-poll-1')
  assert.equal(projectedPoll.poll.options.length, 5)
  assert.equal(projectedPoll.poll.marketReference.rulebookHash, marketReference.rulebookHash)
  assert.equal(projection.state.typingUsers[0].displayName, 'Grace Hopper')
  assert.doesNotThrow(() => encodeRoomFrame({
    version: ROOM_IPC_VERSION,
    type: 'room.state',
    roomId: projection.roomView.room.id,
    revision: 1,
    state: projection.state,
    at: NOW
  }))
  assert.deepEqual(Object.keys(projection.state).sort(), [
    'answerReferences',
    'items',
    'members',
    'polls',
    'typingUsers',
    'unreadState'
  ])
  assert.equal(Object.hasOwn(projection.details, 'fanIq'), false)
  assert.equal(Object.hasOwn(projection.details, 'media'), false)
  assert.equal(Object.hasOwn(projection.details, 'notificationSettings'), false)

  // The signed invite expired in wall-clock time, but projection must remain usable.
  assert.equal(projection.details.invite.status, 'expired')
  assert.equal(projection.details.permissions.canInvite, false)
  assert.equal(projection.roomView.inviteCode, undefined)
  assert.equal(projection.roomView.room.inviteCode, undefined)
})

test('writer-key collisions, invalid retry IDs, duplicate polls, and post-close mutations are rejected', async () => {
  const view = new MemoryView()
  const host = new MemoryHost()
  const creator = createIdentity().keyPair
  const creatorWriter = crypto.randomBytes(32)
  await apply(view, host, creatorWriter, genesisOperation(creator, creatorWriter))

  const room = await valueAt(view, 'meta/room')
  const invitePreview = previewBytes({
    roomId: room.id,
    roomName: room.name,
    fixture: room.fixture,
    memberCount: 1,
    createdBy: room.createdBy,
    createdAt: room.createdAt
  })
  const blindInvite = BlindPairing.createInvite(crypto.randomBytes(32), { data: invitePreview })
  host.discoveryKey = blindInvite.discoveryKey
  const code = encodeBaseInvite({
    invite: blindInvite.invite,
    preview: blindInvite.additional.data,
    signature: blindInvite.additional.signature
  })
  const inviteTime = NOW + 1000
  await apply(view, host, creatorWriter, createOperation('invite.create', {
    id: b4a.toString(blindInvite.id, 'hex'),
    code,
    publicKey: b4a.toString(blindInvite.publicKey, 'hex'),
    preview: b4a.toString(blindInvite.additional.data, 'hex'),
    previewSignature: b4a.toString(blindInvite.additional.signature, 'hex'),
    createdAt: inviteTime,
    expiresAt: null
  }, inviteTime))

  const attacker = createIdentity().keyPair
  const collisionData = encodeCandidateData({
    roomId: room.id,
    writerKey: creatorWriter,
    displayName: 'Mallory',
    identityKeyPair: attacker
  })
  const collisionReceipt = createReceipt(blindInvite.invite, collisionData).receipt
  const collision = createOperation('member.admit', {
    requestId: b4a.toString(crypto.randomBytes(32), 'hex'),
    inviteId: b4a.toString(blindInvite.id, 'hex'),
    receipt: b4a.toString(collisionReceipt, 'hex'),
    candidateData: b4a.toString(collisionData, 'hex')
  }, inviteTime + 1)
  await apply(view, host, creatorWriter, collision)
  assert.equal((await valueAt(view, `operation/${collision.id}`)).applied, false)
  assert.equal((await valueAt(view, `writer/${b4a.toString(creatorWriter, 'hex')}`)).userId, userIdFromPublicKey(creator.publicKey))
  assert.equal(host.added.length, 0)

  const validMessage = createOperation('message.add', {
    id: 'item-retry-1',
    messageId: 'message-retry-1',
    text: 'valid later'
  }, inviteTime + 2)
  const invalidFirst = structuredClone(validMessage)
  invalidFirst.id = 'operation-retry-1'
  invalidFirst.payload.text = 'x'.repeat(1001)
  await apply(view, host, creatorWriter, invalidFirst)
  const validRetry = { ...validMessage, id: invalidFirst.id }
  await apply(view, host, creatorWriter, validRetry)
  assert.equal((await valueAt(view, `operation/${invalidFirst.id}`)).applied, false)
  assert.equal(await valueAt(view, 'item-id/item-retry-1'), null)

  const firstPoll = createOperation('poll.create', {
    id: 'item-poll-1',
    pollId: 'poll-shared-1',
    question: 'Who scores?',
    options: [{ id: 'option-fra', label: 'France' }, { id: 'option-mar', label: 'Morocco' }]
  }, inviteTime + 3)
  const duplicatePoll = createOperation('poll.create', {
    id: 'item-poll-2',
    pollId: 'poll-shared-1',
    question: 'Again?',
    options: [{ id: 'option-yes', label: 'Yes' }, { id: 'option-no', label: 'No' }]
  }, inviteTime + 4)
  await apply(view, host, creatorWriter, firstPoll)
  await apply(view, host, creatorWriter, duplicatePoll)
  assert.equal((await valueAt(view, `operation/${duplicatePoll.id}`)).applied, false)
  const pollProjection = await projectRoom(view, { identityKeyPair: creator, personal: {}, presence: new Map() })
  assert.doesNotThrow(() => encodeRoomFrame({
    version: ROOM_IPC_VERSION,
    type: 'room.state',
    roomId: pollProjection.roomView.room.id,
    revision: 1,
    state: pollProjection.state,
    at: NOW
  }))

  await apply(view, host, creatorWriter, createOperation('room.close', {}, inviteTime + 5))
  const rename = createOperation('room.rename', { name: 'Renamed after close' }, inviteTime + 6)
  await apply(view, host, creatorWriter, rename)
  assert.equal((await valueAt(view, `operation/${rename.id}`)).applied, false)
  assert.equal((await valueAt(view, 'meta/room')).name, 'France v Morocco')

  const leave = createOperation('member.leave', {}, inviteTime + 7)
  await apply(view, host, creatorWriter, leave)
  assert.equal((await valueAt(view, `operation/${leave.id}`)).applied, true)
  assert.equal((await valueAt(view, `member/${userIdFromPublicKey(creator.publicKey)}`)).active, false)
  assert.equal(host.removed.length, 0)
})

test('answer references bind to the actual Autobase writer and remain immutable per member call', async () => {
  const view = new MemoryView()
  const host = new MemoryHost()
  const creator = createIdentity().keyPair
  const creatorWriter = crypto.randomBytes(32)
  await apply(view, host, creatorWriter, genesisOperation(creator, creatorWriter))
  const creatorId = userIdFromPublicKey(creator.publicKey)
  const reference = {
    receiptId: `aat:${'a'.repeat(64)}:2`,
    tokenId: `aat:${'a'.repeat(64)}:2`,
    receiptFeedKey: 'b'.repeat(64),
    receiptIndex: 2,
    userId: creatorId,
    answerId: 'answer:room-view:0002',
    callId: 'call:fixture-9001:0002',
    optionId: 'yes'
  }

  const wrongWriter = createOperation('answer.reference', reference, NOW + 1)
  await apply(view, host, crypto.randomBytes(32), wrongWriter)
  assert.equal((await valueAt(view, `operation/${wrongWriter.id}`)).applied, false)

  const wrongIdentity = createOperation('answer.reference', {
    ...reference,
    userId: 'peer_not_the_autobase_writer',
    answerId: 'answer:room-view:0003',
    receiptId: `aat:${'a'.repeat(64)}:3`,
    tokenId: `aat:${'a'.repeat(64)}:3`,
    receiptIndex: 3
  }, NOW + 2)
  await apply(view, host, creatorWriter, wrongIdentity)
  assert.equal((await valueAt(view, `operation/${wrongIdentity.id}`)).applied, false)

  const accepted = createOperation('answer.reference', reference, NOW + 3)
  await apply(view, host, creatorWriter, accepted)
  assert.equal((await valueAt(view, `operation/${accepted.id}`)).applied, true)

  const duplicate = createOperation('answer.reference', {
    ...reference,
    receiptId: `aat:${'a'.repeat(64)}:4`,
    tokenId: `aat:${'a'.repeat(64)}:4`,
    receiptIndex: 4,
    answerId: 'answer:room-view:0004'
  }, NOW + 4)
  await apply(view, host, creatorWriter, duplicate)
  assert.equal((await valueAt(view, `operation/${duplicate.id}`)).applied, false)

  const projection = await projectRoom(view, { identityKeyPair: creator, personal: {}, presence: new Map() })
  assert.equal(projection.state.answerReferences.length, 1)
  assert.equal(projection.state.answerReferences[0].receiptId, reference.receiptId)
})

test('attachment descriptors require the sending member\'s bound media core and room epoch', async () => {
  const view = new MemoryView()
  const host = new MemoryHost()
  const creator = createIdentity().keyPair
  const creatorWriter = crypto.randomBytes(32)
  await apply(view, host, creatorWriter, genesisOperation(creator, creatorWriter))
  const authorId = userIdFromPublicKey(creator.publicKey)
  const coreKey = 'a'.repeat(64)

  const binding = createOperation('member.media-core', { epoch: 1, coreKey }, NOW + 1)
  await apply(view, host, creatorWriter, binding)
  assert.equal((await valueAt(view, `operation/${binding.id}`)).applied, true)

  const valid = createOperation('message.add', {
    id: 'item-media-bound-1',
    messageId: 'message-media-bound-1',
    text: '',
    attachment: mediaDescriptor({ authorId, coreKey, mediaId: 'media-bound-1' })
  }, NOW + 2)
  await apply(view, host, creatorWriter, valid)
  assert.equal((await valueAt(view, `operation/${valid.id}`)).applied, true)
  const projection = await projectRoom(view, { identityKeyPair: creator, personal: {}, presence: new Map() })
  assert.equal(projection.state.items.find((item) => item.id === 'item-media-bound-1').attachment.coreKey, coreKey)

  const wrongCore = createOperation('message.add', {
    id: 'item-media-wrong-core-1',
    messageId: 'message-media-wrong-core-1',
    text: '',
    attachment: mediaDescriptor({ authorId, coreKey: 'b'.repeat(64), mediaId: 'media-wrong-core-1' })
  }, NOW + 3)
  await apply(view, host, creatorWriter, wrongCore)
  assert.equal((await valueAt(view, `operation/${wrongCore.id}`)).applied, false)

  const wrongAuthor = createOperation('message.add', {
    id: 'item-media-wrong-author-1',
    messageId: 'message-media-wrong-author-1',
    text: '',
    attachment: mediaDescriptor({ authorId: 'peer_not_the_writer', coreKey, mediaId: 'media-wrong-author-1' })
  }, NOW + 4)
  await apply(view, host, creatorWriter, wrongAuthor)
  assert.equal((await valueAt(view, `operation/${wrongAuthor.id}`)).applied, false)
})

test('encrypted moderation reports require the exact active creator/moderator key set', async () => {
  const view = new MemoryView()
  const host = new MemoryHost()
  const creator = createIdentity().keyPair
  const creatorWriter = crypto.randomBytes(32)
  await apply(view, host, creatorWriter, genesisOperation(creator, creatorWriter))
  const creatorId = userIdFromPublicKey(creator.publicKey)
  const agreement = keyAgreementKeyPairFromIdentity(creator)
  const signature = signMemberKeyAgreement(creator, {
    roomId: 'room-view-1',
    userId: creatorId,
    identityPublicKey: creator.publicKey,
    writerKey: creatorWriter,
    keyAgreementPublicKey: agreement.publicKey
  })
  const binding = createOperation('member.key-agreement', {
    publicKey: b4a.toString(agreement.publicKey, 'hex'),
    signature: b4a.toString(signature, 'hex')
  }, NOW + 1)
  await apply(view, host, creatorWriter, binding)
  assert.equal((await valueAt(view, `operation/${binding.id}`)).applied, true)

  const envelope = createEncryptedReport({
    roomId: 'room-view-1',
    reportId: 'report-room-view-1',
    reporterId: creatorId,
    target: { kind: 'member', id: creatorId },
    reason: 'spam',
    note: 'A real encrypted moderation report.',
    createdAt: NOW + 2,
    recipients: [{ userId: creatorId, publicKey: agreement.publicKey }]
  })
  const report = createOperation('moderation.report', {
    reportId: envelope.reportId,
    envelope
  }, NOW + 2)
  await apply(view, host, creatorWriter, report)
  assert.equal((await valueAt(view, `operation/${report.id}`)).applied, true)
  assert.equal(
    openEncryptedReport((await valueAt(view, `report/${envelope.reportId}`)).envelope, {
      userId: creatorId,
      keyPair: agreement
    }).note,
    'A real encrypted moderation report.'
  )

  const stranger = keyAgreementKeyPairFromIdentity(createIdentity().keyPair)
  const wrongRecipient = createEncryptedReport({
    roomId: 'room-view-1',
    reportId: 'report-room-view-stranger',
    reporterId: creatorId,
    target: { kind: 'member', id: creatorId },
    reason: 'spam',
    createdAt: NOW + 3,
    recipients: [{ userId: 'peer_stranger', publicKey: stranger.publicKey }]
  })
  const rejected = createOperation('moderation.report', {
    reportId: wrongRecipient.reportId,
    envelope: wrongRecipient
  }, NOW + 3)
  await apply(view, host, creatorWriter, rejected)
  assert.equal((await valueAt(view, `operation/${rejected.id}`)).applied, false)
})

test('active members admit peers while invite rotation, bans, revocation, and capacity remain enforced', async () => {
  const view = new MemoryView()
  const host = new MemoryHost()
  const creator = createIdentity().keyPair
  const creatorWriter = crypto.randomBytes(32)
  await apply(view, host, creatorWriter, genesisOperation(creator, creatorWriter))

  const firstInvite = await createAndApplyInvite(view, host, creatorWriter, NOW + 1000)
  const delegate = createIdentity().keyPair
  const delegateWriter = crypto.randomBytes(32)
  const delegateAdmission = makeAdmission(firstInvite, delegate, delegateWriter, NOW + 1001, 'Delegate')
  await apply(view, host, creatorWriter, delegateAdmission)
  assert.equal((await valueAt(view, `operation/${delegateAdmission.id}`)).applied, true)

  const peer = createIdentity().keyPair
  const peerWriter = crypto.randomBytes(32)
  const delegatedAdmission = makeAdmission(firstInvite, peer, peerWriter, NOW + 1002, 'Offline joiner')
  await apply(view, host, delegateWriter, delegatedAdmission)
  assert.equal((await valueAt(view, `operation/${delegatedAdmission.id}`)).applied, true)
  assert.equal((await valueAt(view, `member/${userIdFromPublicKey(peer.publicKey)}`)).active, true)

  const forbiddenRevoke = createOperation('invite.revoke', { inviteId: firstInvite.payload.id }, NOW + 1003)
  await apply(view, host, delegateWriter, forbiddenRevoke)
  assert.equal((await valueAt(view, `operation/${forbiddenRevoke.id}`)).applied, false)
  assert.equal((await valueAt(view, 'meta/room')).activeInviteId, firstInvite.payload.id)

  const forbiddenRotation = await makeInvite(view, host, NOW + 1004)
  const forbiddenCreate = createOperation('invite.create', forbiddenRotation.payload, NOW + 1004)
  await apply(view, host, delegateWriter, forbiddenCreate)
  assert.equal((await valueAt(view, `operation/${forbiddenCreate.id}`)).applied, false)
  assert.equal((await valueAt(view, 'meta/room')).activeInviteId, firstInvite.payload.id)

  const currentInvite = await createAndApplyInvite(view, host, creatorWriter, NOW + 1005)
  const stalePeer = createIdentity().keyPair
  const staleAdmission = makeAdmission(firstInvite, stalePeer, crypto.randomBytes(32), NOW + 1006, 'Stale peer')
  await apply(view, host, delegateWriter, staleAdmission)
  assert.equal((await valueAt(view, `operation/${staleAdmission.id}`)).applied, false)

  const revoke = createOperation('invite.revoke', { inviteId: currentInvite.payload.id }, NOW + 1007)
  await apply(view, host, creatorWriter, revoke)
  const revokedPeer = createIdentity().keyPair
  const revokedAdmission = makeAdmission(currentInvite, revokedPeer, crypto.randomBytes(32), NOW + 1008, 'Revoked peer')
  await apply(view, host, delegateWriter, revokedAdmission)
  assert.equal((await valueAt(view, `operation/${revokedAdmission.id}`)).applied, false)

  const finalInvite = await createAndApplyInvite(view, host, creatorWriter, NOW + 1009)
  const removable = createIdentity().keyPair
  const removableWriter = crypto.randomBytes(32)
  const removableAdmission = makeAdmission(finalInvite, removable, removableWriter, NOW + 1010, 'Removed peer')
  await apply(view, host, delegateWriter, removableAdmission)
  const removal = createOperation('member.remove', { userId: userIdFromPublicKey(removable.publicKey) }, NOW + 1011)
  await apply(view, host, creatorWriter, removal)
  assert.equal((await valueAt(view, `member/${userIdFromPublicKey(removable.publicKey)}`)).banned, true)
  const bannedAdmission = makeAdmission(finalInvite, removable, crypto.randomBytes(32), NOW + 1012, 'Removed peer')
  await apply(view, host, delegateWriter, bannedAdmission)
  assert.equal((await valueAt(view, `operation/${bannedAdmission.id}`)).applied, false)

  const room = await valueAt(view, 'meta/room')
  room.memberCount = MAX_ROOM_MEMBERS
  await view.put('meta/room', room)
  const overflow = createIdentity().keyPair
  const overflowAdmission = makeAdmission(finalInvite, overflow, crypto.randomBytes(32), NOW + 1013, 'Overflow peer')
  await apply(view, host, delegateWriter, overflowAdmission)
  assert.equal((await valueAt(view, `operation/${overflowAdmission.id}`)).applied, false)
})

function genesisOperation (creator, writerKey) {
  const roomId = 'room-view-1'
  const displayName = 'Ada'
  const signature = signMemberBinding(creator, {
    roomId,
    identityPublicKey: creator.publicKey,
    writerKey,
    displayName
  })
  return createOperation('room.create', {
    roomId,
    type: 'private',
    name: 'France v Morocco',
    fixture: FIXTURE,
    creator: {
      userId: userIdFromPublicKey(creator.publicKey),
      displayName,
      identityPublicKey: b4a.toString(creator.publicKey, 'hex'),
      writerKey: b4a.toString(writerKey, 'hex'),
      signature: b4a.toString(signature, 'hex')
    }
  }, NOW)
}

async function apply (view, host, writerKey, operation) {
  await applyRoomNodes([{ value: operation, from: { key: writerKey } }], view, host)
}

async function makeInvite (view, host, createdAt) {
  const room = await valueAt(view, 'meta/room')
  const signed = BlindPairing.createInvite(crypto.randomBytes(32), {
    data: previewBytes({
      roomId: room.id,
      roomName: room.name,
      fixture: room.fixture,
      memberCount: room.memberCount,
      createdBy: room.createdBy,
      createdAt: room.createdAt
    })
  })
  host.discoveryKey = signed.discoveryKey
  const code = encodeBaseInvite({
    invite: signed.invite,
    preview: signed.additional.data,
    signature: signed.additional.signature
  })
  return {
    signed,
    payload: {
      id: b4a.toString(signed.id, 'hex'),
      code,
      publicKey: b4a.toString(signed.publicKey, 'hex'),
      preview: b4a.toString(signed.additional.data, 'hex'),
      previewSignature: b4a.toString(signed.additional.signature, 'hex'),
      createdAt,
      expiresAt: null
    }
  }
}

async function createAndApplyInvite (view, host, creatorWriter, createdAt) {
  const invite = await makeInvite(view, host, createdAt)
  const operation = createOperation('invite.create', invite.payload, createdAt)
  await apply(view, host, creatorWriter, operation)
  assert.equal((await valueAt(view, `operation/${operation.id}`)).applied, true)
  return invite
}

function makeAdmission (invite, identityKeyPair, writerKey, createdAt, displayName) {
  const candidateData = encodeCandidateData({
    roomId: 'room-view-1',
    writerKey,
    displayName,
    identityKeyPair
  })
  const { receipt } = createReceipt(invite.signed.invite, candidateData)
  return createOperation('member.admit', {
    requestId: b4a.toString(crypto.randomBytes(32), 'hex'),
    inviteId: invite.payload.id,
    receipt: b4a.toString(receipt, 'hex'),
    candidateData: b4a.toString(candidateData, 'hex')
  }, createdAt)
}

function mediaDescriptor ({ authorId, coreKey, mediaId }) {
  return {
    version: 1,
    epoch: 1,
    mediaId,
    authorId,
    coreKey,
    blob: { blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 80 },
    encryption: {
      algorithm: 'xsalsa20-poly1305-chunked-v1',
      noncePrefix: 'c'.repeat(32),
      plaintextChunkBytes: 65536
    },
    plaintextHash: 'd'.repeat(64),
    hashAlgorithm: 'blake2b-256',
    mimeType: 'text/plain',
    name: 'room-note.txt',
    sizeBytes: 64
  }
}

class MemoryHost {
  constructor () {
    this.added = []
    this.acked = []
    this.removed = []
    this.discoveryKey = null
  }

  async addWriter (key, options) {
    this.added.push({ key: b4a.from(key), options })
  }

  async ackWriter (key) {
    this.acked.push(b4a.from(key))
  }

  removeable () {
    return true
  }

  async removeWriter (key) {
    this.removed.push(b4a.from(key))
  }
}

class MemoryView {
  constructor () {
    this.values = new Map()
  }

  batch () {
    return this
  }

  async get (key) {
    if (!this.values.has(key)) return null
    return { key, value: clone(this.values.get(key)) }
  }

  async put (key, value) {
    this.values.set(key, clone(value))
  }

  async del (key) {
    this.values.delete(key)
  }

  async flush () {}

  async * createReadStream ({ gte = '', lt = '\uffff', reverse = false, limit = -1 } = {}) {
    let entries = [...this.values]
      .filter(([key]) => key >= gte && key < lt)
      .sort(([left], [right]) => left.localeCompare(right))
    if (reverse) entries = entries.reverse()
    if (limit >= 0) entries = entries.slice(0, limit)
    for (const [key, value] of entries) yield { key, value: clone(value) }
  }
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}
