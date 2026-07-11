'use strict'

const { projectMarketSays, projectPressure } = require('../lib/match-intelligence.js')
const { verifyAnswerAcceptanceToken } = require('../lib/answer-attestation.js')

const BASE_CALL_POINTS = 100
const MAX_DIFFICULTY_MULTIPLIER = 5

/**
 * Join a replicated room view to the independent pinned fixture and receipt
 * planes. Room writers supply answer references only; this file is the point at
 * which an answer becomes visible, tallyable, or scoreable.
 */
async function projectRoomIntelligence ({ roomProjection, fixturePlane, answerAttestor, currentUserId }) {
  const fixtureId = String(roomProjection.roomView.fixture.id)
  const fixture = fixturePlane.intelligence(fixtureId)
  if (!fixture) throw codedError('FIXTURE_UNAVAILABLE', 'The room fixture is not available from the verified publisher')

  const rawReferences = Array.isArray(roomProjection.state.answerReferences)
    ? roomProjection.state.answerReferences
    : []
  const resolved = await resolveAnswerReferences({
    references: rawReferences,
    fixture: fixture.card.fixture,
    fixturePlane,
    answerAttestor
  })
  const calls = projectCalls({
    canonicalCalls: fixture.calls,
    answers: resolved.answers,
    frontierFeedTs: fixture.frontierFeedTs,
    currentUserId
  })
  const fanIq = projectFanIq(calls, roomProjection.state.members, currentUserId)
  const receipts = calls.flatMap((call) => call.answers.map((answer) => receiptForAnswer({
    roomId: roomProjection.roomView.room.id,
    fixture: fixture.card.fixture,
    call,
    answer
  })))
  const { answerReferences: _ignored, ...socialState } = roomProjection.state

  const state = {
    ...socialState,
    fixture: fixture.card,
    timeline: fixture.timeline,
    oddsHistory: fixture.oddsHistory,
    marketSays: fixture.marketSays,
    pressure: fixture.pressure,
    frontierFeedTs: fixture.frontierFeedTs,
    calls,
    fanIq,
    receipts,
    unverifiedAnswerReferences: resolved.unverified.length,
    receiptVerificationErrors: resolved.unverified,
    attestationAvailable: Boolean(answerAttestor)
  }
  return {
    ...roomProjection,
    // Calls deliberately expose `myAnswer` alongside `answers`, and receipts
    // reference the same canonical settlement. The v2 boundary forbids shared
    // object identities, so materialize one independent JSON projection here.
    state: JSON.parse(JSON.stringify(state))
  }
}

async function resolveAnswerReferences ({ references, fixture, fixturePlane, answerAttestor }) {
  const answers = []
  const unverified = []
  let fixtureHead = null
  const ordered = references.slice().sort((left, right) => {
    return left.createdAt - right.createdAt || String(left.receiptId).localeCompare(String(right.receiptId))
  })
  for (const reference of ordered) {
    try {
      if (!answerAttestor) {
        throw codedError(
          'ATTESTOR_UNAVAILABLE',
          'Live calls require configured pinned answer-attestor and receipt-feed keys'
        )
      }
      if (!fixtureHead) fixtureHead = await fixturePlane.head()
      const token = await answerAttestor.getVerifiedReceipt(reference.receiptIndex)
      answers.push(verifyReference({ reference, token, pins: answerAttestor.pins, fixture, fixturePlane, fixtureHead }))
    } catch (error) {
      unverified.push({
        receiptId: typeof reference?.receiptId === 'string' ? reference.receiptId : null,
        code: typeof error?.code === 'string' ? error.code : 'RECEIPT_UNVERIFIED'
      })
    }
  }
  return { answers, unverified }
}

function verifyReference ({ reference, token, pins, fixture, fixturePlane, fixtureHead = null }) {
  if (!pins) throw codedError('ATTESTOR_UNAVAILABLE', 'Pinned answer-attestor keys are required to verify a room answer')
  try {
    token = verifyAnswerAcceptanceToken(token, pins)
  } catch (cause) {
    const error = codedError('RECEIPT_INVALID', 'The answer receipt token does not verify against the pinned attestor')
    error.cause = cause
    throw error
  }
  const claims = token?.claims
  const submission = claims?.submission
  if (!claims || !submission) throw codedError('RECEIPT_INVALID', 'The pinned answer receipt has no signed claims')
  if (
    reference.receiptId !== claims.tokenId ||
    reference.tokenId !== claims.tokenId ||
    reference.receiptFeedKey !== claims.receiptFeedKey ||
    reference.receiptIndex !== claims.receiptIndex ||
    reference.userId !== submission.userId ||
    reference.answerId !== submission.answerId ||
    reference.callId !== submission.callId ||
    reference.optionId !== submission.optionId
  ) {
    throw codedError('RECEIPT_REFERENCE_MISMATCH', 'The room answer reference does not match its pinned receipt')
  }
  if (claims.fixtureFeedKey !== fixturePlane.publicKey) {
    throw codedError('RECEIPT_FIXTURE_FEED_MISMATCH', 'The answer receipt is bound to a different fixture publisher')
  }
  if (fixtureHead && (
    fixtureHead.key !== claims.fixtureFeedKey ||
    fixtureHead.fork !== claims.fixtureFeedFork ||
    fixtureHead.length < claims.fixtureFeedLength
  )) {
    throw codedError('RECEIPT_FIXTURE_HEAD_MISMATCH', 'The local signed fixture head cannot verify this answer receipt')
  }
  const canonical = fixturePlane.getCall(submission.callId)
  if (!canonical || canonical.call.fixtureId !== fixture.id) {
    throw codedError('RECEIPT_CALL_UNAVAILABLE', 'The answer receipt references a call outside this room fixture')
  }
  if (
    canonical.callFeedIndex !== claims.callFeedIndex ||
    claims.fixtureId !== canonical.call.fixtureId ||
    claims.locksAt !== canonical.call.locksAt ||
    claims.deadlineAt !== canonical.call.locksAt ||
    claims.fixtureFeedLength <= claims.callFeedIndex
  ) {
    throw codedError('RECEIPT_CALL_MISMATCH', 'The answer receipt does not bind the canonical signed call')
  }
  if (!canonical.call.options.some((option) => option.id === submission.optionId)) {
    throw codedError('RECEIPT_OPTION_MISMATCH', 'The answer receipt selects an option outside the canonical call')
  }
  return {
    receiptId: claims.tokenId,
    tokenId: claims.tokenId,
    receiptFeedKey: claims.receiptFeedKey,
    receiptIndex: claims.receiptIndex,
    servicePublicKey: claims.servicePublicKey,
    userId: submission.userId,
    answerId: submission.answerId,
    callId: submission.callId,
    optionId: submission.optionId,
    submittedAt: submission.submittedAt,
    acceptedAt: claims.serviceReceivedAt,
    locksAt: claims.locksAt,
    fixtureFeedKey: claims.fixtureFeedKey,
    fixtureFeedFork: claims.fixtureFeedFork,
    fixtureFeedLength: claims.fixtureFeedLength,
    fixtureFeedTreeHash: claims.fixtureFeedTreeHash,
    callFeedIndex: claims.callFeedIndex
  }
}

function projectCalls ({ canonicalCalls, answers, frontierFeedTs, currentUserId }) {
  const answersByCall = new Map()
  for (const answer of answers) {
    const entries = answersByCall.get(answer.callId) || []
    entries.push(answer)
    answersByCall.set(answer.callId, entries)
  }
  return canonicalCalls.map((entry) => {
    const callAnswers = (answersByCall.get(entry.call.id) || [])
      .slice()
      .sort((left, right) => left.acceptedAt - right.acceptedAt || left.receiptId.localeCompare(right.receiptId))
    const tally = Object.fromEntries(entry.call.options.map((option) => [option.id, 0]))
    for (const answer of callAnswers) tally[answer.optionId] = (tally[answer.optionId] || 0) + 1
    const status = callStatus(entry, frontierFeedTs)
    const settlement = entry.settlement
    const enriched = callAnswers.map((answer) => {
      const outcome = answerOutcome(answer, entry.call, settlement)
      return {
        ...answer,
        outcome: outcome.outcome,
        points: outcome.points,
        receiptState: outcome.receiptState,
        scored: outcome.scored
      }
    })
    const mine = enriched.find((answer) => answer.userId === currentUserId) || null
    return {
      call: entry.call,
      callFeedIndex: entry.callFeedIndex,
      settlement,
      settlementFeedIndex: entry.settlementFeedIndex,
      status,
      tally,
      total: enriched.length,
      answers: enriched,
      myAnswer: mine,
      outcome: mine?.outcome || null,
      points: mine?.points || 0,
      receiptId: mine?.receiptId || null
    }
  })
}

function callStatus (entry, frontierFeedTs) {
  if (entry.settlement) return entry.settlement.outcome.status === 'void' ? 'void' : 'settled'
  if (frontierFeedTs !== null && frontierFeedTs !== undefined && frontierFeedTs >= entry.call.locksAt) return 'locked'
  return 'open'
}

function answerOutcome (answer, call, settlement) {
  if (!settlement) return { outcome: 'accepted', points: 0, receiptState: 'accepted', scored: false }
  if (settlement.outcome.status === 'void') return { outcome: 'void', points: 0, receiptState: 'void', scored: false }
  if (!call.scored) return {
    outcome: answer.optionId === settlement.outcome.winningOption ? 'correct' : 'incorrect',
    points: 0,
    receiptState: 'proof-pending',
    scored: false
  }
  const correct = answer.optionId === settlement.outcome.winningOption
  const multiplier = difficultyMultiplier(call.difficulty)
  return {
    outcome: correct ? 'correct' : 'incorrect',
    points: correct ? Math.round(BASE_CALL_POINTS * multiplier) : 0,
    receiptState: 'proof-pending',
    scored: true
  }
}

function difficultyMultiplier (difficulty) {
  if (typeof difficulty !== 'number' || !Number.isFinite(difficulty) || difficulty <= 0) return 1
  return Math.min(MAX_DIFFICULTY_MULTIPLIER, Math.max(1, 1 / difficulty))
}

function projectFanIq (calls, members, currentUserId) {
  const displayNames = new Map((Array.isArray(members) ? members : []).map((member) => [member.userId, member.displayName]))
  const scores = new Map()
  for (const call of calls) {
    for (const answer of call.answers) {
      if (!answer.scored) continue
      const value = scores.get(answer.userId) || { points: 0, correct: 0, scored: 0 }
      value.points += answer.points
      value.scored++
      if (answer.outcome === 'correct') value.correct++
      scores.set(answer.userId, value)
    }
  }
  if (!scores.has(currentUserId)) scores.set(currentUserId, { points: 0, correct: 0, scored: 0 })
  const board = [...scores.entries()]
    .map(([userId, score]) => ({
      userId,
      displayName: displayNames.get(userId) || userId,
      fanIq: score.points,
      correctCalls: score.correct,
      scoredCalls: score.scored,
      accuracy: score.scored ? score.correct / score.scored : 0
    }))
    .sort((left, right) => right.fanIq - left.fanIq || right.accuracy - left.accuracy || left.userId.localeCompare(right.userId))
  const mine = board.find((entry) => entry.userId === currentUserId) || board[0]
  return {
    fanIq: mine.fanIq,
    accuracy: mine.accuracy,
    correctCalls: mine.correctCalls,
    scoredCalls: mine.scoredCalls,
    roomRank: board.findIndex((entry) => entry.userId === currentUserId) + 1,
    roomSize: board.length,
    leaderboard: board
  }
}

function receiptForAnswer ({ roomId, fixture, call, answer }) {
  const option = call.call.options.find((candidate) => candidate.id === answer.optionId)
  return {
    id: answer.receiptId,
    roomId,
    fixtureId: fixture.id,
    userId: answer.userId,
    answerId: answer.answerId,
    callId: answer.callId,
    optionId: answer.optionId,
    optionLabel: option?.label || answer.optionId,
    callPrompt: call.call.prompt,
    state: answer.receiptState,
    outcome: answer.outcome,
    points: answer.points,
    scored: answer.scored,
    acceptedAt: answer.acceptedAt,
    submittedAt: answer.submittedAt,
    locksAt: answer.locksAt,
    settlement: call.settlement,
    technical: {
      tokenId: answer.tokenId,
      servicePublicKey: answer.servicePublicKey,
      receiptFeedKey: answer.receiptFeedKey,
      receiptIndex: answer.receiptIndex,
      fixtureFeedKey: answer.fixtureFeedKey,
      fixtureFeedFork: answer.fixtureFeedFork,
      fixtureFeedLength: answer.fixtureFeedLength,
      fixtureFeedTreeHash: answer.fixtureFeedTreeHash,
      callFeedIndex: answer.callFeedIndex,
      anchor: null
    }
  }
}

function projectFixtureIntelligence (fixturePlane, fixtureId) {
  const result = fixturePlane.intelligence(fixtureId)
  if (!result) return null
  return result
}

function codedError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

module.exports = {
  answerOutcome,
  codedError,
  projectFixtureIntelligence,
  projectRoomIntelligence,
  receiptForAnswer,
  resolveAnswerReferences,
  verifyReference
}
