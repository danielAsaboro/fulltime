'use strict'

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { userIdFromPublicKey, validateKeyPair } = require('./room-identity.js')

const ANSWER_ATTESTATION_VERSION = 2
const ANSWER_ATTESTATION_PROTOCOL = 'fulltime/answer-attestation/2'
const ANSWER_SUBMISSION_SIGNATURE_CONTEXT = 'fulltime/answer-submission/v2'
const ANSWER_ACCEPTANCE_SIGNATURE_CONTEXT = 'fulltime/answer-acceptance/v2'
const MAX_ANSWER_ATTESTATION_FRAME_BYTES = 32 * 1024

const HEX_32 = /^[a-f0-9]{64}$/
const HEX_64 = /^[a-f0-9]{128}$/
const IDENTIFIER = /^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u

class AnswerAttestationValidationError extends TypeError {
  constructor (message) {
    super(message)
    this.name = 'AnswerAttestationValidationError'
  }
}

function fail (path, reason) {
  throw new AnswerAttestationValidationError(`${path} ${reason}`)
}

function object (value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'must be a plain object')
  return value
}

function exactKeys (value, expected, path) {
  const keys = Object.keys(value)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    fail(path, `must contain exactly: ${expected.join(', ')}`)
  }
}

function text (value, path, maximum) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.normalize('NFC') !== value) {
    fail(path, `must be non-empty NFC text of at most ${maximum} characters`)
  }
  return value
}

function identifier (value, path, maximum = 256, minimum = 1) {
  const result = text(value, path, maximum)
  if (result.length < minimum || !IDENTIFIER.test(result)) fail(path, 'is not a valid identifier')
  return result
}

function integer (value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(path, `must be a safe integer of at least ${minimum}`)
  return value
}

function hex (value, path, pattern, bytes) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(path, `must be ${bytes}-byte lowercase hex`)
  return value
}

function parseSubmission (value, path = 'answer submission') {
  const input = object(value, path)
  exactKeys(input, [
    'version',
    'requestId',
    'answerId',
    'callId',
    'userId',
    'optionId',
    'submittedAt',
    'identityPublicKey',
    'signature'
  ], path)
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail(`${path}.version`, 'is unsupported')
  return {
    version: ANSWER_ATTESTATION_VERSION,
    requestId: identifier(input.requestId, `${path}.requestId`, 128, 8),
    answerId: identifier(input.answerId, `${path}.answerId`, 128, 3),
    callId: identifier(input.callId, `${path}.callId`, 256),
    userId: identifier(input.userId, `${path}.userId`, 128),
    optionId: identifier(input.optionId, `${path}.optionId`, 64),
    submittedAt: integer(input.submittedAt, `${path}.submittedAt`),
    identityPublicKey: hex(input.identityPublicKey, `${path}.identityPublicKey`, HEX_32, 32),
    signature: hex(input.signature, `${path}.signature`, HEX_64, 64)
  }
}

function answerSubmissionSigningBytes (value) {
  const submission = parseSubmission({ ...value, signature: '0'.repeat(128) })
  return b4a.from(JSON.stringify([
    ANSWER_SUBMISSION_SIGNATURE_CONTEXT,
    submission.version,
    submission.requestId,
    submission.answerId,
    submission.callId,
    submission.userId,
    submission.optionId,
    submission.submittedAt,
    submission.identityPublicKey
  ]))
}

function createSignedAnswerSubmission (identityKeyPair, userId, value) {
  validateKeyPair(identityKeyPair)
  const input = object(value, 'answer input')
  exactKeys(input, [
    'requestId',
    'answerId',
    'callId',
    'optionId',
    'submittedAt'
  ], 'answer input')
  const derivedUserId = userIdFromPublicKey(identityKeyPair.publicKey)
  if (userId !== derivedUserId) fail('answer input.userId', 'does not match the account identity key')
  const unsigned = parseSubmission({
    version: ANSWER_ATTESTATION_VERSION,
    requestId: input.requestId,
    answerId: input.answerId,
    callId: input.callId,
    userId,
    optionId: input.optionId,
    submittedAt: input.submittedAt,
    identityPublicKey: b4a.toString(identityKeyPair.publicKey, 'hex'),
    signature: '0'.repeat(128)
  })
  return {
    ...unsigned,
    signature: b4a.toString(crypto.sign(answerSubmissionSigningBytes(unsigned), identityKeyPair.secretKey), 'hex')
  }
}

function verifySignedAnswerSubmission (value) {
  const submission = parseSubmission(value)
  const publicKey = b4a.from(submission.identityPublicKey, 'hex')
  if (submission.userId !== userIdFromPublicKey(publicKey)) fail('answer submission.userId', 'does not match identityPublicKey')
  if (!crypto.verify(
    answerSubmissionSigningBytes(submission),
    b4a.from(submission.signature, 'hex'),
    publicKey
  )) fail('answer submission.signature', 'is invalid')
  return submission
}

function parseClaims (value, path = 'answer acceptance claims') {
  const input = object(value, path)
  exactKeys(input, [
    'version',
    'tokenId',
    'receiptIndex',
    'servicePublicKey',
    'receiptFeedKey',
    'serviceReceivedAt',
    'deadlineAt',
    'fixtureFeedKey',
    'fixtureFeedFork',
    'fixtureFeedLength',
    'fixtureFeedTreeHash',
    'callFeedIndex',
    'fixtureId',
    'locksAt',
    'submission'
  ], path)
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail(`${path}.version`, 'is unsupported')
  const submission = parseSubmission(input.submission, `${path}.submission`)
  const receiptIndex = integer(input.receiptIndex, `${path}.receiptIndex`)
  const servicePublicKey = hex(input.servicePublicKey, `${path}.servicePublicKey`, HEX_32, 32)
  const serviceReceivedAt = integer(input.serviceReceivedAt, `${path}.serviceReceivedAt`)
  const locksAt = integer(input.locksAt, `${path}.locksAt`)
  const deadlineAt = integer(input.deadlineAt, `${path}.deadlineAt`)
  if (deadlineAt !== locksAt) {
    fail(`${path}.deadlineAt`, 'must equal locksAt')
  }
  const fixtureFeedLength = integer(input.fixtureFeedLength, `${path}.fixtureFeedLength`, 1)
  const callFeedIndex = integer(input.callFeedIndex, `${path}.callFeedIndex`)
  if (callFeedIndex >= fixtureFeedLength) fail(`${path}.callFeedIndex`, 'must be inside the committed feed head')
  const tokenId = identifier(input.tokenId, `${path}.tokenId`, 256)
  if (tokenId !== `aat:${servicePublicKey}:${receiptIndex}`) {
    fail(`${path}.tokenId`, 'must be derived from servicePublicKey and receiptIndex')
  }
  return {
    version: ANSWER_ATTESTATION_VERSION,
    tokenId,
    receiptIndex,
    servicePublicKey,
    receiptFeedKey: hex(input.receiptFeedKey, `${path}.receiptFeedKey`, HEX_32, 32),
    serviceReceivedAt,
    deadlineAt,
    fixtureFeedKey: hex(input.fixtureFeedKey, `${path}.fixtureFeedKey`, HEX_32, 32),
    fixtureFeedFork: integer(input.fixtureFeedFork, `${path}.fixtureFeedFork`),
    fixtureFeedLength,
    fixtureFeedTreeHash: hex(input.fixtureFeedTreeHash, `${path}.fixtureFeedTreeHash`, HEX_32, 32),
    callFeedIndex,
    fixtureId: identifier(input.fixtureId, `${path}.fixtureId`, 256),
    locksAt,
    submission
  }
}

function answerAcceptanceSigningBytes (value) {
  const claims = parseClaims(value)
  const submission = claims.submission
  return b4a.from(JSON.stringify([
    ANSWER_ACCEPTANCE_SIGNATURE_CONTEXT,
    claims.version,
    claims.tokenId,
    claims.receiptIndex,
    claims.servicePublicKey,
    claims.receiptFeedKey,
    claims.serviceReceivedAt,
    claims.deadlineAt,
    claims.fixtureFeedKey,
    claims.fixtureFeedFork,
    claims.fixtureFeedLength,
    claims.fixtureFeedTreeHash,
    claims.callFeedIndex,
    claims.fixtureId,
    claims.locksAt,
    submission.version,
    submission.requestId,
    submission.answerId,
    submission.callId,
    submission.userId,
    submission.optionId,
    submission.submittedAt,
    submission.identityPublicKey,
    submission.signature
  ]))
}

function parseAnswerAcceptanceToken (value) {
  const input = object(value, 'answer acceptance token')
  exactKeys(input, ['claims', 'signature'], 'answer acceptance token')
  return {
    claims: parseClaims(input.claims, 'answer acceptance token.claims'),
    signature: hex(input.signature, 'answer acceptance token.signature', HEX_64, 64)
  }
}

function verifyAnswerAcceptanceToken (value, pins) {
  const input = object(pins, 'answer attestor pins')
  exactKeys(input, ['servicePublicKey', 'receiptFeedKey', 'fixtureFeedKey'], 'answer attestor pins')
  const expectedServiceKey = hex(input.servicePublicKey, 'answer attestor pins.servicePublicKey', HEX_32, 32)
  const expectedReceiptKey = hex(input.receiptFeedKey, 'answer attestor pins.receiptFeedKey', HEX_32, 32)
  const expectedFixtureKey = hex(input.fixtureFeedKey, 'answer attestor pins.fixtureFeedKey', HEX_32, 32)
  const token = parseAnswerAcceptanceToken(value)
  if (token.claims.servicePublicKey !== expectedServiceKey) fail('answer acceptance token.claims.servicePublicKey', 'is not pinned')
  if (token.claims.receiptFeedKey !== expectedReceiptKey) fail('answer acceptance token.claims.receiptFeedKey', 'is not pinned')
  if (token.claims.fixtureFeedKey !== expectedFixtureKey) fail('answer acceptance token.claims.fixtureFeedKey', 'is not pinned')
  if (!crypto.verify(
    answerAcceptanceSigningBytes(token.claims),
    b4a.from(token.signature, 'hex'),
    b4a.from(expectedServiceKey, 'hex')
  )) fail('answer acceptance token.signature', 'is invalid')
  return token
}

function parseAnswerAcceptedReceiptRecord (value) {
  const input = object(value, 'answer receipt record')
  exactKeys(input, ['version', 'kind', 'token'], 'answer receipt record')
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail('answer receipt record.version', 'is unsupported')
  if (input.kind !== 'answer.accepted') fail('answer receipt record.kind', 'is unsupported')
  return {
    version: ANSWER_ATTESTATION_VERSION,
    kind: 'answer.accepted',
    token: parseAnswerAcceptanceToken(input.token)
  }
}

function parseAnswerAttestationResponse (value) {
  const input = object(value, 'answer attestation response')
  if (input.version !== ANSWER_ATTESTATION_VERSION) fail('answer attestation response.version', 'is unsupported')
  if (input.ok === true) {
    exactKeys(input, ['version', 'requestId', 'ok', 'token'], 'answer attestation response')
    const token = parseAnswerAcceptanceToken(input.token)
    const requestId = identifier(input.requestId, 'answer attestation response.requestId', 128, 8)
    if (requestId !== token.claims.submission.requestId) {
      fail('answer attestation response.requestId', 'must match the accepted submission')
    }
    return { version: ANSWER_ATTESTATION_VERSION, requestId, ok: true, token }
  }
  if (input.ok === false) {
    exactKeys(input, ['version', 'requestId', 'ok', 'error'], 'answer attestation response')
    const error = object(input.error, 'answer attestation response.error')
    exactKeys(error, ['code', 'message', 'recoverable'], 'answer attestation response.error')
    if (typeof error.recoverable !== 'boolean') fail('answer attestation response.error.recoverable', 'must be a boolean')
    return {
      version: ANSWER_ATTESTATION_VERSION,
      requestId: input.requestId === null
        ? null
        : identifier(input.requestId, 'answer attestation response.requestId', 128, 8),
      ok: false,
      error: {
        code: identifier(error.code, 'answer attestation response.error.code', 80),
        message: text(error.message, 'answer attestation response.error.message', 1024),
        recoverable: error.recoverable
      }
    }
  }
  fail('answer attestation response.ok', 'must be a boolean')
}

function decodeFrame (bytes, label) {
  if (!b4a.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > MAX_ANSWER_ATTESTATION_FRAME_BYTES) {
    fail(label, `must be 1-${MAX_ANSWER_ATTESTATION_FRAME_BYTES} bytes`)
  }
  try {
    const decoded = b4a.toString(bytes, 'utf8')
    if (!b4a.equals(b4a.from(decoded, 'utf8'), bytes)) fail(label, 'must contain canonical UTF-8')
    return JSON.parse(decoded)
  } catch {
    fail(label, 'must contain valid UTF-8 JSON')
  }
}

function encodeSignedAnswerSubmission (value) {
  const normalized = parseSubmission(value)
  const bytes = b4a.from(JSON.stringify(normalized))
  if (bytes.byteLength > MAX_ANSWER_ATTESTATION_FRAME_BYTES) fail('answer submission frame', 'is too large')
  return bytes
}

function decodeAnswerAttestationResponse (bytes) {
  return parseAnswerAttestationResponse(decodeFrame(bytes, 'answer attestation response frame'))
}

function decodeAnswerAcceptedReceiptRecord (bytes) {
  return parseAnswerAcceptedReceiptRecord(decodeFrame(bytes, 'answer receipt block'))
}

module.exports = {
  ANSWER_ACCEPTANCE_SIGNATURE_CONTEXT,
  ANSWER_ATTESTATION_PROTOCOL,
  ANSWER_ATTESTATION_VERSION,
  ANSWER_SUBMISSION_SIGNATURE_CONTEXT,
  AnswerAttestationValidationError,
  MAX_ANSWER_ATTESTATION_FRAME_BYTES,
  answerAcceptanceSigningBytes,
  answerSubmissionSigningBytes,
  createSignedAnswerSubmission,
  decodeAnswerAcceptedReceiptRecord,
  decodeAnswerAttestationResponse,
  encodeSignedAnswerSubmission,
  parseAnswerAcceptanceToken,
  parseAnswerAcceptedReceiptRecord,
  parseAnswerAttestationResponse,
  parseSignedAnswerSubmission: parseSubmission,
  verifyAnswerAcceptanceToken,
  verifySignedAnswerSubmission
}
