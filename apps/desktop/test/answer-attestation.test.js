'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const {
  answerAcceptanceSigningBytes,
  createSignedAnswerSubmission,
  decodeAnswerAttestationResponse,
  parseSignedAnswerSubmission,
  verifyAnswerAcceptanceToken,
  verifySignedAnswerSubmission
} = require('../lib/answer-attestation.js')
const { userIdFromPublicKey } = require('../lib/room-identity.js')
const { AnswerAttestationStore } = require('../workers/answer-attestation-store.js')

test('Bare answer submission is canonical and identity signed', () => {
  const member = crypto.keyPair(b4a.alloc(32, 7))
  const input = answerInput()
  const submission = createSignedAnswerSubmission(member, userIdFromPublicKey(member.publicKey), input)
  assert.deepEqual(verifySignedAnswerSubmission(submission), submission)
  assert.throws(() => parseSignedAnswerSubmission({ ...submission, ignored: true }), /must contain exactly/)
  assert.throws(() => createSignedAnswerSubmission(member, userIdFromPublicKey(member.publicKey), {
    ...input,
    obsoleteField: 0
  }), /must contain exactly/)
  assert.throws(() => createSignedAnswerSubmission(member, 'peer_wrong', input), /does not match/)
  assert.throws(() => decodeAnswerAttestationResponse(b4a.from([0xff])), /valid UTF-8 JSON/)
})

test('acceptance verification pins application, receipt, and fixture feed keys', () => {
  const { pins, token } = acceptedToken()
  assert.deepEqual(verifyAnswerAcceptanceToken(token, pins), token)
  assert.throws(() => verifyAnswerAcceptanceToken(token, {
    ...pins,
    fixtureFeedKey: '99'.repeat(32)
  }), /fixtureFeedKey is not pinned/)
  assert.throws(() => verifyAnswerAcceptanceToken({
    ...token,
    signature: `${token.signature.startsWith('00') ? '01' : '00'}${token.signature.slice(2)}`
  }, pins), /signature is invalid/)
})

test('verified tokens persist immutably in a real local Hyperbee across restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-attestation-store-'))
  const { pins, token, service } = acceptedToken()
  let corestore = new Corestore(path.join(root, 'corestore'))
  let store = new AnswerAttestationStore(corestore, pins)
  try {
    await corestore.ready()
    await store.ready()
    await store.persist(token)
    assert.deepEqual(await store.getByRequest(token.claims.submission.requestId), token)
    assert.deepEqual(await store.getByReceiptIndex(0), token)

    const conflictingClaims = {
      ...token.claims,
      tokenId: `aat:${pins.servicePublicKey}:1`,
      receiptIndex: 1
    }
    const conflicting = {
      claims: conflictingClaims,
      signature: b4a.toString(crypto.sign(answerAcceptanceSigningBytes(conflictingClaims), service.secretKey), 'hex')
    }
    await assert.rejects(store.persist(conflicting), /different accepted token.*request ID/)

    await store.close()
    await corestore.close()
    corestore = new Corestore(path.join(root, 'corestore'))
    store = new AnswerAttestationStore(corestore, pins)
    await corestore.ready()
    await store.ready()
    assert.deepEqual(await store.getByRequest(token.claims.submission.requestId), token)
  } finally {
    await store.close().catch(() => {})
    await corestore.close().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

function answerInput () {
  return {
    requestId: 'request:desktop:0001',
    answerId: 'answer:desktop:0001',
    callId: 'call:desktop:1',
    optionId: 'home',
    submittedAt: 1_750_000_000_000,
  }
}

function acceptedToken () {
  const member = crypto.keyPair(b4a.alloc(32, 3))
  const service = crypto.keyPair(b4a.alloc(32, 5))
  const pins = {
    servicePublicKey: b4a.toString(service.publicKey, 'hex'),
    receiptFeedKey: '22'.repeat(32),
    fixtureFeedKey: '33'.repeat(32)
  }
  const submission = createSignedAnswerSubmission(member, userIdFromPublicKey(member.publicKey), answerInput())
  const claims = {
    version: 2,
    tokenId: `aat:${pins.servicePublicKey}:0`,
    receiptIndex: 0,
    servicePublicKey: pins.servicePublicKey,
    receiptFeedKey: pins.receiptFeedKey,
    serviceReceivedAt: 1_750_000_001_000,
    deadlineAt: 1_750_000_000_000,
    fixtureFeedKey: pins.fixtureFeedKey,
    fixtureFeedFork: 0,
    fixtureFeedLength: 1,
    fixtureFeedTreeHash: '44'.repeat(32),
    callFeedIndex: 0,
    fixtureId: 'fixture:desktop:1',
    locksAt: 1_750_000_000_000,
    submission
  }
  return {
    pins,
    service,
    token: {
      claims,
      signature: b4a.toString(crypto.sign(answerAcceptanceSigningBytes(claims), service.secretKey), 'hex')
    }
  }
}
