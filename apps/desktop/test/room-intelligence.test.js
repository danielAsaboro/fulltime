'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const {
  answerAcceptanceSigningBytes,
  createSignedAnswerSubmission
} = require('../lib/answer-attestation.js')
const { userIdFromPublicKey } = require('../lib/room-identity.js')
const { answerOutcome, receiptForAnswer, verifyReference } = require('../workers/room-intelligence.js')

const FIXTURE_KEY = '11'.repeat(32)
const RECEIPT_KEY = '22'.repeat(32)

test('room intelligence rejects forged attestation tokens and mismatched fixture references', () => {
  const { pins, token, reference, fixture, fixturePlane } = acceptedFixtureAnswer()
  const fixtureHead = { key: FIXTURE_KEY, fork: 0, length: 1, treeHash: '33'.repeat(32) }
  assert.equal(verifyReference({ reference, token, pins, fixture, fixturePlane, fixtureHead }).receiptId, reference.receiptId)

  const forged = {
    ...token,
    signature: `${token.signature.startsWith('00') ? '01' : '00'}${token.signature.slice(2)}`
  }
  assert.throws(
    () => verifyReference({ reference, token: forged, pins, fixture, fixturePlane }),
    (error) => error.code === 'RECEIPT_INVALID'
  )

  assert.throws(
    () => verifyReference({
      reference,
      token,
      pins,
      fixture,
      fixturePlane,
      fixtureHead: { ...fixtureHead, fork: 1 }
    }),
    (error) => error.code === 'RECEIPT_FIXTURE_HEAD_MISMATCH'
  )

  assert.throws(
    () => verifyReference({
      reference,
      token,
      pins,
      fixture,
      fixturePlane: { ...fixturePlane, getCall: () => null }
    }),
    (error) => error.code === 'RECEIPT_CALL_UNAVAILABLE'
  )

  assert.throws(
    () => verifyReference({
      reference: { ...reference, optionId: 'fabricated' },
      token,
      pins,
      fixture,
      fixturePlane
    }),
    (error) => error.code === 'RECEIPT_REFERENCE_MISMATCH'
  )
})

test('receipt projection stays proof-pending without an external pinned anchor observation', () => {
  const { token, fixture, fixturePlane, reference, pins } = acceptedFixtureAnswer()
  const answer = verifyReference({ reference, token, pins, fixture, fixturePlane })
  const call = fixturePlane.getCall(answer.callId).call
  const settlement = {
    id: `settlement:${call.id}`,
    callId: call.id,
    outcome: { status: 'settled', winningOption: 'yes' },
    settledAtFeedTs: 1_700_000_000_500,
    decidingMessageIds: ['fixture:answer:score:1']
  }
  const outcome = answerOutcome(answer, call, settlement)
  assert.equal(outcome.receiptState, 'proof-pending')
  const receipt = receiptForAnswer({
    roomId: 'room_intelligence_1',
    fixture,
    call: { call, settlement },
    answer: { ...answer, ...outcome }
  })
  assert.equal(receipt.state, 'proof-pending')
  assert.equal(receipt.technical.anchor, null)
})

function acceptedFixtureAnswer () {
  const member = crypto.keyPair(b4a.alloc(32, 3))
  const service = crypto.keyPair(b4a.alloc(32, 5))
  const pins = {
    servicePublicKey: b4a.toString(service.publicKey, 'hex'),
    receiptFeedKey: RECEIPT_KEY,
    fixtureFeedKey: FIXTURE_KEY
  }
  const submission = createSignedAnswerSubmission(member, userIdFromPublicKey(member.publicKey), {
    requestId: 'request:room-intelligence:0001',
    answerId: 'answer:room-intelligence:0001',
    callId: 'call:fixture-answer:0001',
    optionId: 'yes',
    submittedAt: 1_700_000_000_000
  })
  const claims = {
    version: 2,
    tokenId: `aat:${pins.servicePublicKey}:0`,
    receiptIndex: 0,
    servicePublicKey: pins.servicePublicKey,
    receiptFeedKey: pins.receiptFeedKey,
    serviceReceivedAt: 1_700_000_000_001,
    deadlineAt: 1_700_000_010_000,
    fixtureFeedKey: pins.fixtureFeedKey,
    fixtureFeedFork: 0,
    fixtureFeedLength: 1,
    fixtureFeedTreeHash: '33'.repeat(32),
    callFeedIndex: 0,
    fixtureId: 'fixture-answer',
    locksAt: 1_700_000_010_000,
    submission
  }
  const token = {
    claims,
    signature: b4a.toString(crypto.sign(answerAcceptanceSigningBytes(claims), service.secretKey), 'hex')
  }
  const fixture = { id: 'fixture-answer' }
  const call = {
    id: submission.callId,
    fixtureId: fixture.id,
    locksAt: claims.locksAt,
    options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    scored: true,
    difficulty: 0.5
  }
  const fixturePlane = {
    publicKey: pins.fixtureFeedKey,
    getCall: (callId) => callId === call.id ? { call, callFeedIndex: 0 } : null
  }
  return {
    pins,
    token,
    fixture,
    fixturePlane,
    reference: {
      receiptId: claims.tokenId,
      tokenId: claims.tokenId,
      receiptFeedKey: claims.receiptFeedKey,
      receiptIndex: claims.receiptIndex,
      userId: submission.userId,
      answerId: submission.answerId,
      callId: submission.callId,
      optionId: submission.optionId
    }
  }
}
