'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const {
  MAX_MESSAGE_LENGTH,
  MAX_INVITE_CODE_LENGTH,
  MAX_INVITE_PREVIEW_BYTES,
  MAX_OPERATION_BYTES,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  ROOM_PROTOCOL_VERSION
} = require('./room-constants.js')
const { normalizeDisplayName } = require('./room-identity.js')
const { validateAdmissionClaim } = require('./admission-claim.js')
const { validateMediaDescriptor } = require('./encrypted-media.js')
const { validateFixturePreview } = require('./invite-code.js')
const { validateEncryptedReportEnvelope } = require('./moderation-report.js')

const OPERATION_TYPES = new Set([
  'room.create',
  'room.rename',
  'room.slow-mode',
  'room.close',
  'invite.create',
  'invite.revoke',
  'member.admit',
  'member.claim',
  'member.key-agreement',
  'member.media-core',
  'member.rename',
  'member.remove',
  'member.role',
  'member.leave',
  'message.add',
  'moderation.report',
  'poll.create',
  'poll.vote',
  'answer.reference',
  'reaction.add',
  'reply.add'
])

const ID_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/
const HEX_32_PATTERN = /^[a-f0-9]{64}$/
const HEX_64_PATTERN = /^[a-f0-9]{128}$/
const REACTION_EMOJIS = new Set(['🔥', '⚽', '👏', '😮'])

function operationId (prefix = 'op') {
  return `${prefix}_${b4a.toString(crypto.randomBytes(16), 'hex')}`
}

function createOperation (type, payload, createdAt = Date.now()) {
  return validateRoomOperation({
    version: ROOM_PROTOCOL_VERSION,
    id: operationId(type.replace(/\./g, '-')),
    type,
    createdAt,
    payload
  })
}

function validateRoomOperation (operation) {
  plainObject(operation, 'Room operation')
  if (operation.version !== ROOM_PROTOCOL_VERSION) throw new TypeError('Room operation version is unsupported')
  identifier(operation.id, 'Operation ID')
  if (!OPERATION_TYPES.has(operation.type)) throw new TypeError('Room operation type is unsupported')
  timestamp(operation.createdAt, 'Operation timestamp')
  plainObject(operation.payload, 'Operation payload')

  const encoded = JSON.stringify(operation)
  if (b4a.byteLength(encoded) > MAX_OPERATION_BYTES) throw new TypeError('Room operation is too large')

  switch (operation.type) {
    case 'room.create':
      validateRoomCreate(operation.payload)
      break
    case 'room.rename':
      boundedText(operation.payload.name, 'Room name', 1, MAX_ROOM_NAME_LENGTH)
      break
    case 'room.slow-mode':
      integer(operation.payload.seconds, 'Slow mode', 0, 60)
      break
    case 'room.close':
    case 'member.leave':
      emptyObject(operation.payload)
      break
    case 'invite.create':
      validateInvite(operation.payload)
      break
    case 'invite.revoke':
      hex(operation.payload.inviteId, 'Invite ID', HEX_32_PATTERN)
      break
    case 'member.admit':
      validateAdmission(operation.payload)
      break
    case 'member.claim':
      validateAdmissionClaim(operation.payload)
      break
    case 'member.media-core':
      validateMediaCoreBinding(operation.payload)
      break
    case 'member.key-agreement':
      validateKeyAgreementBinding(operation.payload)
      break
    case 'member.rename':
      onlyFields(operation.payload, ['displayName'], 'Member rename')
      if (normalizeDisplayName(operation.payload.displayName) !== operation.payload.displayName) {
        throw new TypeError('Member display name must be normalized')
      }
      break
    case 'member.remove':
      identifier(operation.payload.userId, 'Member user ID')
      break
    case 'member.role':
      identifier(operation.payload.userId, 'Member user ID')
      if (operation.payload.role !== 'member' && operation.payload.role !== 'moderator') {
        throw new TypeError('Member role is invalid')
      }
      break
    case 'message.add':
      validateMessage(operation.payload)
      break
    case 'moderation.report':
      validateModerationReport(operation.payload)
      break
    case 'poll.create':
      validatePoll(operation.payload)
      break
    case 'poll.vote':
      identifier(operation.payload.pollId, 'Poll ID')
      identifier(operation.payload.optionId, 'Poll option ID')
      break
    case 'answer.reference':
      validateAnswerReference(operation.payload)
      break
    case 'reaction.add':
      identifier(operation.payload.itemId, 'Reaction item ID')
      if (typeof operation.payload.emoji !== 'string' || !REACTION_EMOJIS.has(operation.payload.emoji.trim())) {
        throw new TypeError('Reaction is unsupported')
      }
      break
    case 'reply.add':
      identifier(operation.payload.id, 'Reply ID')
      identifier(operation.payload.itemId, 'Reply item ID')
      boundedText(operation.payload.text, 'Reply', 1, MAX_MESSAGE_LENGTH)
      break
  }

  return operation
}

function validateRoomCreate (payload) {
  identifier(payload.roomId, 'Room ID')
  boundedText(payload.name, 'Room name', 1, MAX_ROOM_NAME_LENGTH)
  if (payload.type !== 'private') throw new TypeError('Pear-created rooms must be private')
  plainObject(payload.fixture, 'Fixture')
  validateFixturePreview(payload.fixture)
  if (!payload.creator || typeof payload.creator !== 'object') throw new TypeError('Room creator is required')
  validateMemberBinding(payload.creator)
}

function validateMemberBinding (member) {
  plainObject(member, 'Member binding')
  identifier(member.userId, 'Member user ID')
  if (normalizeDisplayName(member.displayName) !== member.displayName) {
    throw new TypeError('Member display name must be normalized')
  }
  hex(member.identityPublicKey, 'Member identity key', HEX_32_PATTERN)
  hex(member.writerKey, 'Member writer key', HEX_32_PATTERN)
  hex(member.signature, 'Member identity signature', HEX_64_PATTERN)
}

function validateInvite (payload) {
  hex(payload.id, 'Invite ID', HEX_32_PATTERN)
  boundedText(payload.code, 'Invite code', 10, MAX_INVITE_CODE_LENGTH)
  hex(payload.publicKey, 'Invite public key', HEX_32_PATTERN)
  hexBytes(payload.preview, 'Invite preview', 1, MAX_INVITE_PREVIEW_BYTES)
  hex(payload.previewSignature, 'Invite preview signature', HEX_64_PATTERN)
  timestamp(payload.createdAt, 'Invite createdAt')
  if (payload.expiresAt !== null) {
    timestamp(payload.expiresAt, 'Invite expiresAt')
    if (payload.expiresAt <= payload.createdAt) throw new TypeError('Invite expiry must be after creation')
  }
}

function validateAdmission (payload) {
  hex(payload.requestId, 'Admission request ID', HEX_32_PATTERN)
  hex(payload.inviteId, 'Admission invite ID', HEX_32_PATTERN)
  hexBytes(payload.receipt, 'Admission receipt', 1, 8192)
  hexBytes(payload.candidateData, 'Admission candidate data', 1, 4096)
}

function validateMessage (payload) {
  onlyFields(payload, ['id', 'messageId', 'text', 'attachment'], 'Message')
  identifier(payload.id, 'Message item ID')
  identifier(payload.messageId, 'Message ID')
  if (typeof payload.text !== 'string') throw new TypeError('Message must be a string')
  if (!Object.hasOwn(payload, 'attachment')) {
    boundedText(payload.text, 'Message', 1, MAX_MESSAGE_LENGTH)
    return
  }
  if (payload.text !== '') boundedText(payload.text, 'Message', 1, MAX_MESSAGE_LENGTH)
  validateMediaDescriptor(payload.attachment)
}

function validateMediaCoreBinding (payload) {
  onlyFields(payload, ['epoch', 'coreKey'], 'Media core binding')
  if (!Number.isSafeInteger(payload.epoch) || payload.epoch < 1 || payload.epoch > 0x7fffffff) {
    throw new TypeError('Media epoch is invalid')
  }
  hex(payload.coreKey, 'Media core key', HEX_32_PATTERN)
}

function validateKeyAgreementBinding (payload) {
  onlyFields(payload, ['publicKey', 'signature'], 'Member key-agreement binding')
  hex(payload.publicKey, 'Member key-agreement public key', HEX_32_PATTERN)
  hex(payload.signature, 'Member key-agreement signature', HEX_64_PATTERN)
}

function validateModerationReport (payload) {
  onlyFields(payload, ['reportId', 'envelope'], 'Moderation report')
  identifier(payload.reportId, 'Moderation report ID')
  const envelope = validateEncryptedReportEnvelope(payload.envelope)
  if (envelope.reportId !== payload.reportId) throw new TypeError('Moderation report envelope ID does not match')
}

function validatePoll (payload) {
  identifier(payload.id, 'Poll item ID')
  identifier(payload.pollId, 'Poll ID')
  boundedText(payload.question, 'Poll question', 1, MAX_POLL_QUESTION_LENGTH)
  if (!Array.isArray(payload.options) || payload.options.length < 2 || payload.options.length > MAX_POLL_OPTIONS) {
    throw new TypeError(`Polls need between 2 and ${MAX_POLL_OPTIONS} options`)
  }
  const labels = new Set()
  const optionIds = new Set()
  for (const option of payload.options) {
    plainObject(option, 'Poll option')
    identifier(option.id, 'Poll option ID')
    if (optionIds.has(option.id)) throw new TypeError('Poll option IDs must be unique')
    optionIds.add(option.id)
    const label = boundedText(option.label, 'Poll option', 1, MAX_POLL_OPTION_LENGTH)
    const normalized = label.toLowerCase()
    if (labels.has(normalized)) throw new TypeError('Poll options must be unique')
    labels.add(normalized)
  }
}

function validateAnswerReference (payload) {
  onlyFields(payload, [
    'receiptId',
    'tokenId',
    'receiptFeedKey',
    'receiptIndex',
    'userId',
    'answerId',
    'callId',
    'optionId'
  ], 'Answer reference')
  identifier(payload.receiptId, 'Answer receipt ID')
  identifier(payload.tokenId, 'Answer token ID')
  if (payload.receiptId !== payload.tokenId) throw new TypeError('Answer receipt ID must match token ID')
  hex(payload.receiptFeedKey, 'Answer receipt feed key', HEX_32_PATTERN)
  if (!Number.isSafeInteger(payload.receiptIndex) || payload.receiptIndex < 0) {
    throw new TypeError('Answer receipt index is invalid')
  }
  const token = /^aat:([a-f0-9]{64}):(\d+)$/.exec(payload.tokenId)
  if (!token || !Number.isSafeInteger(Number(token[2])) || Number(token[2]) !== payload.receiptIndex) {
    throw new TypeError('Answer token ID is invalid')
  }
  identifier(payload.userId, 'Answer user ID')
  identifier(payload.answerId, 'Answer ID')
  identifier(payload.callId, 'Answer call ID')
  identifier(payload.optionId, 'Answer option ID')
}

function boundedText (value, label, minimum, maximum) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  const text = value.trim()
  if (text.length < minimum || text.length > maximum || /[\u0000\u007f]/.test(text)) {
    throw new TypeError(`${label} must be ${minimum}-${maximum} characters`)
  }
  return text
}

function identifier (value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function timestamp (value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`)
  return value
}

function integer (value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function plainObject (value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value
}

function emptyObject (value) {
  if (Object.keys(value).length !== 0) throw new TypeError('Operation payload must be empty')
}

function onlyFields (value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} field ${key} is unsupported`)
  }
}

function hex (value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value) || value.length % 2 !== 0) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function hexBytes (value, label, minimumBytes, maximumBytes) {
  if (typeof value !== 'string' || !/^[a-f0-9]+$/.test(value) || value.length % 2 !== 0 ||
      value.length < minimumBytes * 2 || value.length > maximumBytes * 2) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

module.exports = {
  HEX_32_PATTERN,
  HEX_64_PATTERN,
  ID_PATTERN,
  OPERATION_TYPES,
  REACTION_EMOJIS,
  createOperation,
  operationId,
  validateRoomOperation
}
