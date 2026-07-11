'use strict'

const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const Hyperbee = require('hyperbee')
const crypto = require('hypercore-crypto')

const { verifyAdmissionClaim } = require('../lib/admission-claim.js')
const { addReferral, parseInviteCode, previewBytes, referralBytes } = require('../lib/invite-code.js')
const {
  decodeCandidateData,
  fromHex,
  userIdFromPublicKey,
  verifyMemberBinding
} = require('../lib/room-identity.js')
const {
  MAX_HISTORY_ITEMS,
  MAX_PAGE_CURSOR_LENGTH,
  MAX_PAGE_ITEMS,
  MAX_REPLY_ITEMS,
  MAX_ROOM_MEMBERS,
  MAX_ROOM_MODERATORS,
  ROOM_DATA_EPOCH
} = require('../lib/room-constants.js')
const { validateMediaDescriptor } = require('../lib/encrypted-media.js')
const { keyAgreementKeyId, verifyMemberKeyAgreement } = require('../lib/member-crypto.js')
const { validateEncryptedReportEnvelope } = require('../lib/moderation-report.js')
const { ID_PATTERN, validateRoomOperation } = require('../lib/room-operations.js')

function openRoomView (store) {
  return new Hyperbee(store.get('room-view'), {
    extension: false,
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
}

async function closeRoomView (view) {
  await view.close()
}

async function applyRoomNodes (nodes, view, host) {
  const batch = view.batch()
  for (const node of nodes) {
    if (!node.value) continue
    const rawId = markerId(node.value)
    if (rawId && (await valueAt(batch, `operation/${rawId}`)) !== null) continue
    let operation
    try {
      operation = validateRoomOperation(node.value)
    } catch {
      if (rawId) {
        await batch.put(`operation/${rawId}`, {
          applied: false,
          reason: 'Room operation failed validation'
        })
      }
      continue
    }
    if ((await valueAt(batch, `operation/${operation.id}`)) !== null) continue
    const applied = await applyRoomOperation(operation, node, batch, host)
    await batch.put(`operation/${operation.id}`, applied
      ? { applied: true, type: operation.type }
      : { applied: false, reason: 'Room operation was rejected by room policy', type: operation.type })
  }
  await batch.flush()
}

function markerId (value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.id === 'string' && ID_PATTERN.test(value.id)
    ? value.id
    : null
}

async function applyRoomOperation (operation, node, db, host) {
  const writerKey = b4a.toString(node.from.key, 'hex')
  const room = await valueAt(db, 'meta/room')

  if (operation.type === 'room.create') {
    if (room) return false
    return applyRoomCreate(operation, writerKey, db)
  }
  if (!room) return false

  if (operation.type === 'member.claim') {
    return applyMemberClaim(operation, writerKey, node, room, db, host)
  }

  const actor = await actorForWriter(db, writerKey)
  if (!actor || !actor.active || actor.banned) return false
  if (operation.createdAt < actor.joinedAt) return false
  await host.ackWriter(node.from.key)

  switch (operation.type) {
    case 'room.rename':
      if (!isCreator(actor) || room.isClosed) return false
      room.name = operation.payload.name.trim()
      await db.put('meta/room', room)
      return true
    case 'room.slow-mode':
      if (!isCreator(actor) || room.isClosed) return false
      room.slowModeSeconds = operation.payload.seconds
      await db.put('meta/room', room)
      return true
    case 'room.close':
      if (!isCreator(actor) || room.isClosed) return false
      room.isClosed = true
      if (room.activeInviteId) {
        const invite = await valueAt(db, `invite/${room.activeInviteId}`)
        if (invite && !invite.revokedAt) {
          invite.revokedAt = operation.createdAt
          await db.put(`invite/${invite.id}`, invite)
        }
      }
      room.activeInviteId = null
      await db.put('meta/room', room)
      return true
    case 'invite.create':
      return applyInviteCreate(operation, actor, room, db, host)
    case 'invite.revoke':
      return applyInviteRevoke(operation, actor, room, db)
    case 'member.admit':
      return applyMemberAdmission(operation, actor, room, db, host)
    case 'member.key-agreement':
      return applyMemberKeyAgreement(operation, actor, writerKey, room, db)
    case 'member.media-core':
      return applyMemberMediaCore(operation, actor, room, db)
    case 'member.rename':
      if (room.isClosed) return false
      actor.displayName = operation.payload.displayName
      await db.put(`member/${actor.userId}`, actor)
      return true
    case 'member.remove':
      return applyMemberRemoval(operation, actor, room, db, host)
    case 'member.role':
      return applyMemberRole(operation, actor, room, db)
    case 'member.leave':
      return applyMemberLeave(operation, actor, room, db, host)
    case 'message.add':
      return applyMessage(operation, actor, room, db)
    case 'moderation.report':
      return applyModerationReport(operation, actor, room, db)
    case 'poll.create':
      return applyPoll(operation, actor, room, db)
    case 'poll.vote':
      return applyPollVote(operation, actor, room, db)
    case 'answer.reference':
      return applyAnswerReference(operation, actor, room, db)
    case 'reaction.add':
      return applyReaction(operation, actor, room, db)
    case 'reply.add':
      return applyReply(operation, actor, room, db)
    default:
      return false
  }
}

async function applyRoomCreate (operation, writerKey, db) {
  const payload = operation.payload
  if (payload.creator.writerKey !== writerKey) return false
  const identityPublicKey = fromHex(payload.creator.identityPublicKey, 'Creator identity key', 32)
  const creatorWriterKey = fromHex(payload.creator.writerKey, 'Creator writer key', 32)
  const signature = fromHex(payload.creator.signature, 'Creator identity signature', 64)
  if (payload.creator.userId !== userIdFromPublicKey(identityPublicKey)) return false
  if (!verifyMemberBinding({
    roomId: payload.roomId,
    identityPublicKey,
    writerKey: creatorWriterKey,
    displayName: payload.creator.displayName,
    signature
  })) return false

  const member = {
    userId: payload.creator.userId,
    displayName: payload.creator.displayName,
    identityPublicKey: payload.creator.identityPublicKey,
    writerKey,
    role: 'creator',
    joinedAt: operation.createdAt,
    active: true,
    banned: false,
    lastPostAt: null
  }
  await db.put('meta/room', {
    id: payload.roomId,
    fixture: payload.fixture,
    type: 'private',
    name: payload.name.trim(),
    createdBy: member.userId,
    createdAt: operation.createdAt,
    activeInviteId: null,
    memberCount: 1,
    sequence: 0,
    epoch: ROOM_DATA_EPOCH,
    slowModeSeconds: 0,
    isClosed: false
  })
  await db.put(`member/${member.userId}`, member)
  await db.put(`writer/${writerKey}`, { userId: member.userId })
  await db.put(`joined/${member.userId}`, { firstJoinedAt: operation.createdAt })
  await appendSystemItem(db, payload.roomId, operation, `Room created by ${member.displayName}`, 'success')
  return true
}

async function applyInviteCreate (operation, actor, room, db, host) {
  if (!isCreator(actor) || room.isClosed) return false
  const payload = operation.payload
  let parsed
  try {
    parsed = parseInviteCode(payload.code, { now: operation.createdAt })
  } catch {
    return false
  }
  const expectedPreview = previewBytes({
    roomId: room.id,
    roomName: room.name,
    fixture: room.fixture,
    memberCount: room.memberCount,
    createdBy: room.createdBy,
    createdAt: room.createdAt
  })
  if (
    payload.createdAt !== operation.createdAt ||
    parsed.baseCode !== payload.code ||
    parsed.referral !== null ||
    !b4a.isBuffer(host.discoveryKey) ||
    !b4a.equals(parsed.discoveryKey, host.discoveryKey) ||
    b4a.toString(parsed.blindInviteId, 'hex') !== payload.id ||
    b4a.toString(parsed.invitePublicKey, 'hex') !== payload.publicKey ||
    b4a.toString(parsed.previewBytes, 'hex') !== payload.preview ||
    b4a.toString(parsed.previewSignature, 'hex') !== payload.previewSignature ||
    parsed.expiresAt !== payload.expiresAt ||
    !b4a.equals(parsed.previewBytes, expectedPreview)
  ) return false
  if (room.activeInviteId) {
    const current = await valueAt(db, `invite/${room.activeInviteId}`)
    if (current && !current.revokedAt) {
      current.revokedAt = operation.createdAt
      await db.put(`invite/${current.id}`, current)
    }
  }
  const invite = {
    ...payload,
    createdBy: actor.userId,
    revokedAt: null,
    useCount: 0
  }
  await db.put(`invite/${invite.id}`, invite)
  room.activeInviteId = invite.id
  await db.put('meta/room', room)
  return true
}

async function applyInviteRevoke (operation, actor, room, db) {
  if (!isCreator(actor)) return false
  const invite = await valueAt(db, `invite/${operation.payload.inviteId}`)
  if (!invite || invite.revokedAt) return false
  invite.revokedAt = operation.createdAt
  await db.put(`invite/${invite.id}`, invite)
  if (room.activeInviteId === invite.id) {
    room.activeInviteId = null
    await db.put('meta/room', room)
  }
  return true
}

async function applyMemberAdmission (operation, actor, room, db, host) {
  if (!actor.active || actor.banned || room.isClosed) return false
  const payload = operation.payload
  const existingAdmission = await valueAt(db, `admission/${payload.requestId}`)
  if (existingAdmission) {
    let candidate
    try {
      candidate = decodeCandidateData(b4a.from(payload.candidateData, 'hex'), room.id)
    } catch {
      return false
    }
    return existingAdmission.inviteId === payload.inviteId &&
      existingAdmission.userId === candidate.userId &&
      existingAdmission.writerKey === b4a.toString(candidate.writerKey, 'hex')
  }
  const invite = await valueAt(db, `invite/${payload.inviteId}`)
  if (!invite || invite.revokedAt || room.activeInviteId !== invite.id) return false
  if (invite.expiresAt && operation.createdAt >= invite.expiresAt) return false

  const receipt = b4a.from(payload.receipt, 'hex')
  const candidateData = b4a.from(payload.candidateData, 'hex')
  let verified
  try {
    verified = BlindPairing.verifyReceipt(receipt, b4a.from(invite.publicKey, 'hex'))
  } catch {
    return false
  }
  if (!verified || !b4a.equals(verified, candidateData)) return false

  let candidate
  try {
    candidate = decodeCandidateData(candidateData, room.id)
  } catch {
    return false
  }
  let member = await valueAt(db, `member/${candidate.userId}`)
  if (member && member.banned) return false
  const wasActive = Boolean(member && member.active)
  if (!wasActive && room.memberCount >= MAX_ROOM_MEMBERS) return false
  if (wasActive && member.writerKey !== b4a.toString(candidate.writerKey, 'hex')) return false

  const writerKeyHex = b4a.toString(candidate.writerKey, 'hex')
  const writerOwner = await valueAt(db, `writer/${writerKeyHex}`)
  if (writerOwner && writerOwner.userId !== candidate.userId) return false
  if (!wasActive) await host.addWriter(candidate.writerKey, { indexer: false })

  if (member && !wasActive && member.writerKey !== writerKeyHex) {
    const oldWriterOwner = await valueAt(db, `writer/${member.writerKey}`)
    if (oldWriterOwner && oldWriterOwner.userId === candidate.userId) {
      await db.del(`writer/${member.writerKey}`)
    }
  }

  const firstJoin = !(await valueAt(db, `joined/${candidate.userId}`))
  member = {
    userId: candidate.userId,
    displayName: candidate.displayName,
    identityPublicKey: b4a.toString(candidate.identityPublicKey, 'hex'),
    writerKey: writerKeyHex,
    role: member ? member.role : 'member',
    joinedAt: member ? member.joinedAt : operation.createdAt,
    active: true,
    banned: false,
    lastPostAt: member ? member.lastPostAt : null
  }
  await db.put(`member/${member.userId}`, member)
  await db.put(`writer/${writerKeyHex}`, { userId: member.userId })
  await db.put(`admission/${payload.requestId}`, {
    inviteId: invite.id,
    userId: member.userId,
    writerKey: writerKeyHex,
    admittedAt: operation.createdAt
  })

  if (!wasActive) room.memberCount++
  if (firstJoin) {
    await db.put(`joined/${member.userId}`, { firstJoinedAt: operation.createdAt, inviteId: invite.id })
    await db.put(`invite-use/${invite.id}/${member.userId}`, { joinedAt: operation.createdAt })
    invite.useCount++
    await db.put(`invite/${invite.id}`, invite)
    await applyReferral(candidate, invite, member, operation, db)
  }
  await db.put('meta/room', room)
  if (!wasActive) {
    await appendSystemItem(db, room.id, operation, `${member.displayName} joined the room`, 'info', 'member-joined')
  }
  return true
}

async function applyMemberClaim (operation, writerKey, node, room, db, host) {
  const claim = operation.payload
  if (operation.createdAt !== claim.issuedAt || room.isClosed) return false
  const signer = await valueAt(db, `member/${claim.admittedBy}`)
  if (!signer || !signer.active || signer.banned) return false
  let signerIdentity
  let candidate
  try {
    signerIdentity = fromHex(signer.identityPublicKey, 'Admission signer identity key', 32)
    candidate = decodeCandidateData(b4a.from(claim.candidateData, 'hex'), room.id)
  } catch {
    return false
  }
  if (b4a.toString(candidate.writerKey, 'hex') !== writerKey) return false
  if (!verifyAdmissionClaim(claim, signerIdentity)) return false
  const applied = await applyMemberAdmission(operation, signer, room, db, host)
  if (applied) await host.ackWriter(node.from.key)
  return applied
}

async function applyReferral (candidate, invite, member, operation, db) {
  if (!candidate.referral || candidate.referral.userId === member.userId) return
  if (!crypto.verify(referralBytes(invite.code), candidate.referral.signature, candidate.referral.identityPublicKey)) return
  const referrer = await valueAt(db, `member/${candidate.referral.userId}`)
  if (!referrer || !referrer.active || referrer.banned) return
  if (referrer.identityPublicKey !== b4a.toString(candidate.referral.identityPublicKey, 'hex')) return
  await db.put(`referral/${referrer.userId}/${member.userId}`, {
    inviteId: invite.id,
    joinedAt: operation.createdAt
  })
}

async function applyMemberRemoval (operation, actor, room, db, host) {
  if (!isCreator(actor) || room.isClosed) return false
  const member = await valueAt(db, `member/${operation.payload.userId}`)
  if (!member || !member.active || member.role === 'creator') return false
  const writerKey = b4a.from(member.writerKey, 'hex')
  if (!host.removeable(writerKey)) return false
  await host.removeWriter(writerKey)
  member.active = false
  member.banned = true
  await db.put(`member/${member.userId}`, member)
  room.memberCount--
  await db.put('meta/room', room)
  await appendSystemItem(db, room.id, operation, `${member.displayName} was removed from the room`, 'warning')
  return true
}

async function applyMemberRole (operation, actor, room, db) {
  if (!isCreator(actor) || room.isClosed) return false
  const member = await valueAt(db, `member/${operation.payload.userId}`)
  if (!member || !member.active || member.role === 'creator') return false
  if (operation.payload.role === 'moderator' && member.role !== 'moderator') {
    const staff = (await scan(db, 'member/')).filter((candidate) => candidate.active &&
      (candidate.role === 'creator' || candidate.role === 'moderator'))
    if (staff.length >= MAX_ROOM_MODERATORS) return false
  }
  member.role = operation.payload.role
  await db.put(`member/${member.userId}`, member)
  return true
}

async function applyMemberKeyAgreement (operation, actor, writerKey, room, db) {
  const publicKey = b4a.from(operation.payload.publicKey, 'hex')
  const signature = b4a.from(operation.payload.signature, 'hex')
  const identityPublicKey = b4a.from(actor.identityPublicKey, 'hex')
  if (!verifyMemberKeyAgreement({
    roomId: room.id,
    userId: actor.userId,
    identityPublicKey,
    writerKey: b4a.from(writerKey, 'hex'),
    keyAgreementPublicKey: publicKey,
    signature
  })) return false
  const key = `key-agreement/${actor.userId}`
  const existing = await valueAt(db, key)
  if (existing && existing.publicKey !== operation.payload.publicKey) return false
  if (existing && existing.writerKey === writerKey) return true
  await db.put(key, {
    userId: actor.userId,
    publicKey: operation.payload.publicKey,
    writerKey,
    boundAt: operation.createdAt
  })
  return true
}

async function applyMemberMediaCore (operation, actor, room, db) {
  if (room.isClosed || operation.payload.epoch !== (room.epoch || ROOM_DATA_EPOCH)) return false
  const key = `media-core/${actor.userId}/${operation.payload.epoch}`
  const existing = await valueAt(db, key)
  if (existing) return existing.coreKey === operation.payload.coreKey
  await db.put(key, {
    userId: actor.userId,
    epoch: operation.payload.epoch,
    coreKey: operation.payload.coreKey,
    boundAt: operation.createdAt
  })
  return true
}

async function applyMemberLeave (operation, actor, room, db, host) {
  if (actor.role === 'creator' && !room.isClosed) return false
  // Autobase cannot remove its last indexer. A creator can leave only after the
  // room is terminal, so deactivate their application-level membership while
  // retaining the inert bootstrap writer in the Autobase system view.
  if (actor.role !== 'creator') {
    const writerKey = b4a.from(actor.writerKey, 'hex')
    if (!host.removeable(writerKey)) return false
    await host.removeWriter(writerKey)
  }
  actor.active = false
  actor.banned = false
  await db.put(`member/${actor.userId}`, actor)
  room.memberCount--
  await db.put('meta/room', room)
  await appendSystemItem(db, room.id, operation, `${actor.displayName} left the room`, 'info')
  return true
}

async function applyMessage (operation, actor, room, db) {
  if (room.isClosed || !passesSlowMode(actor, room, operation.createdAt)) return false
  const payload = operation.payload
  if (await valueAt(db, `item-id/${payload.id}`)) return false
  if (await valueAt(db, `message-id/${payload.messageId}`)) return false
  let attachment = null
  if (Object.hasOwn(payload, 'attachment')) {
    try {
      attachment = validateMediaDescriptor(payload.attachment)
    } catch {
      return false
    }
    if (attachment.authorId !== actor.userId || attachment.epoch !== (room.epoch || ROOM_DATA_EPOCH)) return false
    const binding = await valueAt(db, `media-core/${actor.userId}/${attachment.epoch}`)
    if (!binding || binding.coreKey !== attachment.coreKey) return false
    if (await valueAt(db, `media/${actor.userId}/${attachment.mediaId}`)) return false
  }
  const sequence = await nextSequence(db)
  const key = itemKey(sequence, payload.id)
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  await db.put(key, {
    id: payload.id,
    messageId: payload.messageId,
    roomId: room.id,
    kind: 'text',
    authorId: actor.userId,
    createdAt: operation.createdAt,
    text,
    ...(attachment ? { attachment } : {})
  })
  await db.put(`item-id/${payload.id}`, { key, kind: 'text' })
  await db.put(`message-id/${payload.messageId}`, { itemId: payload.id })
  if (attachment) {
    await db.put(`media/${actor.userId}/${attachment.mediaId}`, {
      itemId: payload.id,
      epoch: attachment.epoch,
      coreKey: attachment.coreKey
    })
  }
  await markPosted(db, actor, operation.createdAt)
  return true
}

async function applyModerationReport (operation, actor, room, db) {
  let envelope
  try {
    envelope = validateEncryptedReportEnvelope(operation.payload.envelope)
  } catch {
    return false
  }
  if (envelope.reportId !== operation.payload.reportId) return false
  if (await valueAt(db, `report/${envelope.reportId}`)) return false
  const recipients = await reportRecipients(db)
  if (recipients.length < 1 || recipients.length !== envelope.keyWraps.length) return false
  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index]
    const wrap = envelope.keyWraps[index]
    if (recipient.userId !== wrap.userId || recipient.keyId !== wrap.keyId) return false
  }
  await db.put(`report/${envelope.reportId}`, {
    reportId: envelope.reportId,
    reporterId: actor.userId,
    createdAt: operation.createdAt,
    envelope
  })
  return true
}

async function reportRecipients (db) {
  const staff = (await scan(db, 'member/'))
    .filter((member) => member.active && (member.role === 'creator' || member.role === 'moderator'))
    .sort((left, right) => left.userId.localeCompare(right.userId))
  if (staff.length > MAX_ROOM_MODERATORS) return []
  const recipients = []
  for (const member of staff) {
    const binding = await valueAt(db, `key-agreement/${member.userId}`)
    if (!binding || binding.userId !== member.userId || typeof binding.publicKey !== 'string' || !/^[a-f0-9]{64}$/.test(binding.publicKey)) {
      return []
    }
    recipients.push({ userId: member.userId, keyId: keyAgreementKeyId(b4a.from(binding.publicKey, 'hex')) })
  }
  return recipients
}

async function applyPoll (operation, actor, room, db) {
  if (room.isClosed || !passesSlowMode(actor, room, operation.createdAt)) return false
  const payload = operation.payload
  if (await valueAt(db, `item-id/${payload.id}`)) return false
  if (await valueAt(db, `poll/${payload.pollId}`)) return false
  const sequence = await nextSequence(db)
  const key = itemKey(sequence, payload.id)
  await db.put(key, {
    id: payload.id,
    roomId: room.id,
    kind: 'poll',
    authorId: actor.userId,
    createdAt: operation.createdAt,
    poll: {
      id: payload.pollId,
      roomId: room.id,
      question: payload.question.trim(),
      options: payload.options.map((option) => ({ id: option.id, label: option.label.trim(), votes: 0 })),
      scored: false,
      createdAt: operation.createdAt
    }
  })
  await db.put(`item-id/${payload.id}`, { key, kind: 'poll', pollId: payload.pollId })
  await db.put(`poll/${payload.pollId}`, { itemId: payload.id, options: payload.options.map((option) => option.id) })
  await markPosted(db, actor, operation.createdAt)
  return true
}

async function applyPollVote (operation, actor, room, db) {
  if (room.isClosed) return false
  const poll = await valueAt(db, `poll/${operation.payload.pollId}`)
  if (!poll || !poll.options.includes(operation.payload.optionId)) return false
  const key = `poll-vote/${operation.payload.pollId}/${actor.userId}`
  if (await valueAt(db, key)) return false
  await db.put(key, { userId: actor.userId, optionId: operation.payload.optionId, votedAt: operation.createdAt })
  return true
}

/**
 * Room writers can only reference an attestor receipt. They never append a
 * token, call, settlement, odds value, or proof claim. The manager verifies the
 * reference against the pinned receipt and fixture feeds before projecting it.
 */
async function applyAnswerReference (operation, actor, room, db) {
  if (room.isClosed || operation.payload.userId !== actor.userId) return false
  const payload = operation.payload
  const memberCallKey = `answer-member-call/${actor.userId}/${payload.callId}`
  if (await valueAt(db, memberCallKey)) return false
  if (await valueAt(db, `answer-token/${payload.tokenId}`)) return false
  if (await valueAt(db, `answer-id/${payload.answerId}`)) return false
  const sequence = await nextSequence(db)
  const key = `answer/${sequenceKey(sequence)}/${payload.receiptId}`
  await db.put(key, {
    ...payload,
    roomId: room.id,
    createdAt: operation.createdAt,
    writerKey: actor.writerKey
  })
  await db.put(memberCallKey, { receiptId: payload.receiptId })
  await db.put(`answer-token/${payload.tokenId}`, { receiptId: payload.receiptId })
  await db.put(`answer-id/${payload.answerId}`, { receiptId: payload.receiptId })
  return true
}

async function applyReaction (operation, actor, room, db) {
  if (room.isClosed) return false
  const target = await valueAt(db, `item-id/${operation.payload.itemId}`)
  if (!target || target.kind !== 'text') return false
  const emojiHex = b4a.toString(b4a.from(operation.payload.emoji.trim()), 'hex')
  const key = `reaction/${operation.payload.itemId}/${emojiHex}/${actor.userId}`
  if (await valueAt(db, key)) return true
  await db.put(key, { emoji: operation.payload.emoji.trim(), userId: actor.userId, createdAt: operation.createdAt })
  return true
}

async function applyReply (operation, actor, room, db) {
  if (room.isClosed || !passesSlowMode(actor, room, operation.createdAt)) return false
  const target = await valueAt(db, `item-id/${operation.payload.itemId}`)
  if (!target) return false
  if (await valueAt(db, `reply-id/${operation.payload.id}`)) return false
  const sequence = await nextSequence(db)
  await db.put(`reply/${operation.payload.itemId}/${sequenceKey(sequence)}/${operation.payload.id}`, {
    id: operation.payload.id,
    itemId: operation.payload.itemId,
    roomId: room.id,
    authorId: actor.userId,
    text: operation.payload.text.trim(),
    createdAt: operation.createdAt
  })
  await db.put(`reply-id/${operation.payload.id}`, { itemId: operation.payload.itemId })
  const countKey = `reply-count/${operation.payload.itemId}`
  const count = await valueAt(db, countKey)
  await db.put(countKey, { count: (count ? count.count : 0) + 1 })
  await markPosted(db, actor, operation.createdAt)
  return true
}

function passesSlowMode (actor, room, createdAt) {
  if (!room.slowModeSeconds || actor.lastPostAt === null) return true
  return createdAt >= actor.lastPostAt && createdAt - actor.lastPostAt >= room.slowModeSeconds * 1000
}

async function markPosted (db, actor, createdAt) {
  actor.lastPostAt = createdAt
  await db.put(`member/${actor.userId}`, actor)
}

async function appendSystemItem (db, roomId, operation, text, tone, noticeType) {
  const id = `system_${operation.id}`
  if (await valueAt(db, `item-id/${id}`)) return
  const sequence = await nextSequence(db)
  const key = itemKey(sequence, id)
  await db.put(key, {
    id,
    roomId,
    kind: 'system',
    text,
    tone,
    ...(noticeType ? { noticeType } : {}),
    createdAt: operation.createdAt
  })
  await db.put(`item-id/${id}`, { key, kind: 'system' })
}

async function nextSequence (db) {
  const room = await valueAt(db, 'meta/room')
  room.sequence++
  await db.put('meta/room', room)
  return room.sequence
}

function itemKey (sequence, id) {
  return `item/${sequenceKey(sequence)}/${id}`
}

function sequenceKey (sequence) {
  return String(sequence).padStart(16, '0')
}

async function actorForWriter (db, writerKey) {
  const mapping = await valueAt(db, `writer/${writerKey}`)
  if (!mapping) return null
  return valueAt(db, `member/${mapping.userId}`)
}

function isCreator (member) {
  return member.role === 'creator'
}

async function valueAt (db, key) {
  const entry = await db.get(key)
  return entry ? entry.value : null
}

async function scan (db, prefix, { reverse = false, limit = -1 } = {}) {
  const values = []
  for await (const entry of db.createReadStream({
    gte: prefix,
    lt: `${prefix}\xff`,
    reverse,
    limit
  })) values.push(entry.value)
  return values
}

async function projectHistoryPage (view, { identityKeyPair, limit = 50, cursor = null }) {
  const room = await valueAt(view, 'meta/room')
  if (!room) throw new Error('Room has not been initialized')
  const pageSize = pageLimit(limit)
  const epoch = room.epoch || ROOM_DATA_EPOCH
  const prefix = 'item/'
  const boundary = decodePageCursor(cursor, {
    kind: 'history',
    roomId: room.id,
    epoch,
    scope: '',
    prefix
  })
  const entries = await pageEntries(view, prefix, boundary, pageSize)
  const page = entries.slice(0, pageSize)
  const currentUserId = userIdFromPublicKey(identityKeyPair.publicKey)
  const memberById = await memberMap(view)
  const items = []
  for (const entry of page) {
    const item = entry.value
    const reactions = item.kind === 'text'
      ? await scan(view, `reaction/${item.id}/`, { limit: MAX_ROOM_MEMBERS * 4 })
      : []
    const replyCount = await valueAt(view, `reply-count/${item.id}`)
    const pollVotes = new Map()
    if (item.kind === 'poll') {
      pollVotes.set(item.poll.id, await scan(view, `poll-vote/${item.poll.id}/`, { limit: MAX_ROOM_MEMBERS }))
    }
    items.push(projectItem(
      item,
      memberById,
      currentUserId,
      reactions,
      [],
      replyCount ? replyCount.count : 0,
      pollVotes
    ))
  }
  const hasMore = entries.length > pageSize
  return {
    items,
    nextCursor: hasMore
      ? encodePageCursor({
          kind: 'history',
          roomId: room.id,
          epoch,
          scope: '',
          boundary: page[page.length - 1].key
        })
      : null,
    hasMore,
    epoch,
    revision: room.sequence
  }
}

async function projectThreadPage (view, itemId, { identityKeyPair, limit = 50, cursor = null }) {
  const room = await valueAt(view, 'meta/room')
  if (!room) throw new Error('Room has not been initialized')
  if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId)) throw new TypeError('itemId is invalid')
  const target = await valueAt(view, `item-id/${itemId}`)
  if (!target) throw new Error('Thread item was not found')
  const pageSize = pageLimit(limit)
  const epoch = room.epoch || ROOM_DATA_EPOCH
  const prefix = `reply/${itemId}/`
  const boundary = decodePageCursor(cursor, {
    kind: 'thread',
    roomId: room.id,
    epoch,
    scope: itemId,
    prefix
  })
  const entries = await pageEntries(view, prefix, boundary, pageSize)
  const page = entries.slice(0, pageSize)
  const currentUserId = userIdFromPublicKey(identityKeyPair.publicKey)
  const memberById = await memberMap(view)
  const items = page.map((entry) => projectReply(entry.value, memberById, currentUserId))
  const hasMore = entries.length > pageSize
  return {
    items,
    nextCursor: hasMore
      ? encodePageCursor({
          kind: 'thread',
          roomId: room.id,
          epoch,
          scope: itemId,
          boundary: page[page.length - 1].key
        })
      : null,
    hasMore,
    epoch,
    revision: room.sequence
  }
}

async function memberMap (view) {
  const members = await scan(view, 'member/')
  return new Map(members.map((member) => [member.userId, member]))
}

async function pageEntries (view, prefix, boundary, limit) {
  const entries = []
  for await (const entry of view.createReadStream({
    gte: prefix,
    lt: boundary || `${prefix}\xff`,
    reverse: true,
    limit: limit + 1
  })) {
    entries.push({ key: String(entry.key), value: entry.value })
  }
  return entries
}

function pageLimit (limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_ITEMS) {
    throw new TypeError(`limit must be an integer from 1 to ${MAX_PAGE_ITEMS}`)
  }
  return limit
}

function encodePageCursor ({ kind, roomId, epoch, scope, boundary }) {
  const document = JSON.stringify([1, kind, roomId, epoch, scope, boundary])
  const encoded = b4a.toString(b4a.from(document), 'base64url')
  const cursor = `ftc1_${encoded}`
  if (cursor.length > MAX_PAGE_CURSOR_LENGTH) throw new Error('Generated room cursor exceeds its bound')
  return cursor
}

function decodePageCursor (cursor, expected) {
  if (cursor === null || cursor === undefined) return null
  if (
    typeof cursor !== 'string' ||
    cursor.length < 6 ||
    cursor.length > MAX_PAGE_CURSOR_LENGTH ||
    !cursor.startsWith('ftc1_')
  ) throw new TypeError('Room page cursor is invalid')
  const encoded = cursor.slice(5)
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new TypeError('Room page cursor is invalid')
  let document
  try {
    const bytes = b4a.from(encoded, 'base64url')
    if (bytes.byteLength > 768 || b4a.toString(bytes, 'base64url') !== encoded) throw new Error('non-canonical')
    document = JSON.parse(b4a.toString(bytes))
  } catch {
    throw new TypeError('Room page cursor is invalid')
  }
  if (
    !Array.isArray(document) ||
    document.length !== 6 ||
    document[0] !== 1 ||
    document[1] !== expected.kind ||
    document[2] !== expected.roomId ||
    document[3] !== expected.epoch ||
    document[4] !== expected.scope ||
    !validPageBoundary(document[5], expected.prefix, expected.scope)
  ) throw new TypeError('Room page cursor does not belong to this room, epoch, or thread')
  return document[5]
}

function validPageBoundary (boundary, prefix, scope) {
  if (typeof boundary !== 'string' || boundary.length > 320 || !boundary.startsWith(prefix)) return false
  const parts = boundary.split('/')
  if (scope) {
    return parts.length === 4 && parts[0] === 'reply' && parts[1] === scope && /^\d{16}$/.test(parts[2]) && ID_PATTERN.test(parts[3])
  }
  return parts.length === 3 && parts[0] === 'item' && /^\d{16}$/.test(parts[1]) && ID_PATTERN.test(parts[2])
}

async function projectRoom (view, { identityKeyPair, personal = {}, presence = new Map() }) {
  const room = await valueAt(view, 'meta/room')
  if (!room) throw new Error('Room has not been initialized')
  const currentUserId = userIdFromPublicKey(identityKeyPair.publicKey)
  const allMembers = await scan(view, 'member/')
  const members = allMembers.filter((member) => member.active)
  const memberById = new Map(allMembers.map((member) => [member.userId, member]))
  const referralCounts = new Map()
  const referralEntries = []
  for await (const entry of view.createReadStream({ gte: 'referral/', lt: 'referral/\xff' })) {
    const [, referrerUserId, inviteeUserId] = entry.key.split('/')
    referralEntries.push({ referrerUserId, inviteeUserId, ...entry.value })
    referralCounts.set(referrerUserId, (referralCounts.get(referrerUserId) || 0) + 1)
  }

  const memberViews = members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    role: member.role,
    joinedAt: member.joinedAt,
    isOnline: member.userId === currentUserId || presence.has(member.userId),
    isCurrentUser: member.userId === currentUserId,
    successfulInvites: referralCounts.get(member.userId) || 0
  }))

  const rawItems = await scan(view, 'item/', { reverse: true, limit: MAX_HISTORY_ITEMS })
  rawItems.reverse()
  const reactions = new Map()
  const replies = new Map()
  const replyCounts = new Map()
  const pollVotes = new Map()
  for (const item of rawItems) {
    if (item.kind === 'text') {
      reactions.set(item.id, await scan(view, `reaction/${item.id}/`, { limit: MAX_ROOM_MEMBERS * 4 }))
    }
    const itemReplies = await scan(view, `reply/${item.id}/`, { reverse: true, limit: MAX_REPLY_ITEMS })
    itemReplies.reverse()
    replies.set(item.id, itemReplies)
    const count = await valueAt(view, `reply-count/${item.id}`)
    replyCounts.set(item.id, count ? count.count : itemReplies.length)
    if (item.kind === 'poll') {
      pollVotes.set(item.poll.id, await scan(view, `poll-vote/${item.poll.id}/`, { limit: MAX_ROOM_MEMBERS }))
    }
  }

  const items = rawItems.map((item) => projectItem(
    item,
    memberById,
    currentUserId,
    reactions.get(item.id) || [],
    replies.get(item.id) || [],
    replyCounts.get(item.id) || 0,
    pollVotes
  ))
  const answerReferences = await scan(view, 'answer/', { limit: MAX_HISTORY_ITEMS * 4 })
  const currentMember = memberById.get(currentUserId) || null
  const activeInvite = room.activeInviteId ? await valueAt(view, `invite/${room.activeInviteId}`) : null
  const inviteUses = activeInvite ? await scan(view, `invite-use/${activeInvite.id}/`) : []
  const viewerReferrals = referralEntries.filter((entry) => entry.referrerUserId === currentUserId)
  const now = Date.now()
  const inviteExpired = Boolean(activeInvite?.expiresAt && activeInvite.expiresAt <= now)
  let viewerInviteCode = activeInvite?.code
  if (activeInvite && !activeInvite.revokedAt && !inviteExpired) {
    viewerInviteCode = addReferral(activeInvite.code, identityKeyPair, { now })
  }
  const invite = activeInvite && !activeInvite.revokedAt
    ? {
        id: activeInvite.id,
        roomId: room.id,
        code: viewerInviteCode,
        url: `/join/${encodeURIComponent(viewerInviteCode)}`,
        createdBy: activeInvite.createdBy,
        createdAt: activeInvite.createdAt,
        expiresAt: activeInvite.expiresAt,
        revokedAt: activeInvite.revokedAt,
        status: inviteExpired ? 'expired' : 'active',
        successfulJoins: inviteUses.length,
        viewerSuccessfulJoins: viewerReferrals.length
      }
    : null

  const readCursor = personal.lastReadItemId || null
  const unreadState = unreadFor(items, readCursor, currentUserId)
  return {
    roomView: {
      room: roomDocument(room, invite?.status === 'active' ? invite.code : undefined),
      fixture: room.fixture,
      phase: phaseOf(room.fixture.status),
      members: members.length,
      ...(invite?.status === 'active' ? { inviteCode: invite.code } : {})
    },
    details: {
      room: roomDocument(room, invite?.status === 'active' ? invite.code : undefined),
      fixture: room.fixture,
      members: memberViews,
      invite,
      influence: influenceFor(viewerReferrals.length),
      slowModeSeconds: room.slowModeSeconds,
      isClosed: room.isClosed,
      permissions: permissionsFor(currentMember, room, invite)
    },
    state: {
      // IPC frames deliberately reject shared object references. Keep these
      // convenience projections independent from their canonical item/member
      // entries even though JSON.stringify would otherwise duplicate them.
      polls: items.filter((item) => item.kind === 'poll').map((item) => ({
        ...item.poll,
        options: item.poll.options.map((option) => ({ ...option }))
      })),
      items,
      answerReferences,
      members: memberViews,
      typingUsers: memberViews
        .filter((member) => presence.get(member.userId)?.typing)
        .map((member) => ({ ...member })),
      unreadState
    }
  }
}

function projectItem (item, members, currentUserId, rawReactions, rawReplies, replyCount, pollVotes) {
  const member = item.authorId ? members.get(item.authorId) : null
  const author = member
    ? {
        userId: member.userId,
        displayName: member.displayName,
        role: member.role,
        isCurrentUser: member.userId === currentUserId
      }
    : undefined
  const reactionMap = new Map()
  for (const reaction of rawReactions) {
    let summary = reactionMap.get(reaction.emoji)
    if (!summary) {
      summary = { emoji: reaction.emoji, count: 0, reactedByMe: false }
      reactionMap.set(reaction.emoji, summary)
    }
    summary.count++
    if (reaction.userId === currentUserId) summary.reactedByMe = true
  }
  const replies = rawReplies
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((reply) => projectReply(reply, members, currentUserId))
  const base = {
    ...item,
    ...(author ? { author } : {}),
    reactions: [...reactionMap.values()],
    replies,
    replyCount,
    permalink: `/room/${item.roomId}?item=${item.id}`
  }
  delete base.authorId
  // Old local materialized views may carry this former presentation field.
  // It is not part of the room projection after the timing feature removal.
  delete base.releaseAt
  if (base.kind === 'poll') {
    const votes = pollVotes.get(base.poll.id) || []
    base.poll = {
      ...base.poll,
      options: base.poll.options.map((option) => ({
        ...option,
        votes: votes.filter((vote) => vote.optionId === option.id).length
      }))
    }
    const mine = votes.find((vote) => vote.userId === currentUserId)
    if (mine) base.myVote = mine.optionId
  }
  return base
}

function projectReply (reply, members, currentUserId) {
  const replyMember = members.get(reply.authorId)
  return {
    id: reply.id,
    itemId: reply.itemId,
    roomId: reply.roomId,
    author: {
      userId: reply.authorId,
      displayName: replyMember ? replyMember.displayName : 'Former member',
      role: replyMember ? replyMember.role : 'member',
      isCurrentUser: reply.authorId === currentUserId
    },
    text: reply.text,
    createdAt: reply.createdAt,
    reactions: []
  }
}

function unreadFor (items, lastReadItemId, currentUserId) {
  const candidates = items.filter((item) => !item.author || item.author.userId !== currentUserId)
  let unread
  if (lastReadItemId) {
    const index = items.findIndex((item) => item.id === lastReadItemId)
    unread = index < 0 ? candidates.slice(-3) : items.slice(index + 1).filter((item) => !item.author || item.author.userId !== currentUserId)
  } else unread = candidates.slice(-3)
  return {
    count: unread.length,
    firstUnreadItemId: unread.length ? unread[0].id : null,
    lastReadItemId,
    isAtLiveEdge: unread.length === 0
  }
}

function roomDocument (room, inviteCode) {
  return {
    id: room.id,
    fixtureId: room.fixture.id,
    type: 'private',
    name: room.name,
    ...(inviteCode ? { inviteCode } : {}),
    createdBy: room.createdBy,
    createdAt: room.createdAt
  }
}

function permissionsFor (member, room, invite) {
  const creator = Boolean(member && member.active && member.role === 'creator')
  const joined = Boolean(member && member.active)
  const activeInvite = Boolean(invite && invite.status === 'active')
  return {
    canInvite: joined && !room.isClosed && activeInvite,
    canRename: creator && !room.isClosed,
    canRegenerateInvite: creator && !room.isClosed,
    canRevokeInvite: creator && !room.isClosed && activeInvite,
    canModerateMembers: creator && !room.isClosed,
    canSetSlowMode: creator && !room.isClosed,
    canCloseRoom: creator && !room.isClosed
  }
}

function influenceFor (joins) {
  const thresholds = [0, 1, 3, 7, 15]
  let level = 1
  while (level < thresholds.length && joins >= thresholds[level]) level++
  const floor = thresholds[level - 1] || 0
  const next = thresholds[level] === undefined ? null : thresholds[level]
  return {
    score: joins * 100,
    level,
    successfulJoins: joins,
    nextLevelAt: next,
    progress: next === null ? 1 : Math.min(1, (joins - floor) / (next - floor))
  }
}

function phaseOf (status) {
  if (['scheduled', 'delayed', 'postponed'].includes(status)) return 'upcoming'
  if (['full-time', 'after-extra-time', 'after-penalties', 'abandoned', 'cancelled'].includes(status)) return 'finished'
  return 'live'
}

module.exports = {
  applyRoomNodes,
  closeRoomView,
  openRoomView,
  phaseOf,
  projectHistoryPage,
  projectRoom,
  projectThreadPage,
  scan,
  valueAt
}
