'use strict'

const { MAX_POLL_OPTIONS } = require('./room-constants.js')
const { REACTION_EMOJIS } = require('./room-operations.js')

const ACTION_TYPES = new Set(['message', 'quote', 'reply', 'reaction', 'poll', 'vote', 'call'])
const KEY_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/
const OPTION_PATTERN = /^[a-zA-Z0-9._:-]{1,180}$/

function createHistoricalClock () {
  let historicalTime = null
  return {
    now: () => historicalTime === null ? Date.now() : historicalTime,
    set (timestamp) {
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new TypeError('Historical timestamp is invalid')
      historicalTime = timestamp
    },
    reset () {
      historicalTime = null
    }
  }
}

async function seedHistoricalRoom ({ seed, actors, beforeAction = null, waitTimeoutMs = 35_000 }) {
  const normalized = validateSeed(seed)
  const actorMap = normalizeActors(actors, normalized.personas)
  if (beforeAction !== null && typeof beforeAction !== 'function') throw new TypeError('Historical room beforeAction hook must be a function')
  const creator = normalized.personas.find((persona) => persona.creator)
  const creatorRuntime = actorMap.get(creator.id)
  const itemIds = new Map()
  const polls = new Map()
  const receipts = new Map()

  try {
    setClock(creatorRuntime, normalized.room.createdAt)
    const details = await creatorRuntime.manager.dispatch('room.create', {
      fixtureId: normalized.fixtureId,
      roomName: normalized.room.name,
      displayName: creator.displayName
    })
    const roomId = details.room.id

    for (const persona of normalized.personas) {
      if (persona.creator) continue
      const runtime = actorMap.get(persona.id)
      setClock(creatorRuntime, persona.joinedAt)
      setClock(runtime, persona.joinedAt)
      await runtime.manager.dispatch('session.sign-in', { displayName: persona.displayName })
      await runtime.manager.dispatch('room.join', { code: details.invite.code })
      await waitFor(async () => {
        const state = await creatorRuntime.manager.dispatch('room.state', { roomId })
        return state.members.some((member) => member.displayName === persona.displayName)
      }, `membership replication for ${persona.displayName}`, waitTimeoutMs)
    }

    for (let actionIndex = 0; actionIndex < normalized.actions.length; actionIndex++) {
      const action = normalized.actions[actionIndex]
      if (beforeAction) await beforeAction({ action, actionIndex, roomId })
      const runtime = actorMap.get(action.actor)
      setClock(runtime, action.at)
      if (action.type === 'message') {
        const item = await runtime.manager.dispatch('room.message.send', {
          roomId,
          input: { text: action.text }
        })
        rememberItem(itemIds, action.key, item.id)
        continue
      }
      if (action.type === 'quote') {
        const quotedItemId = requiredReference(itemIds, action.item, 'Quoted item')
        await waitForItem(runtime.manager, roomId, quotedItemId, waitTimeoutMs)
        const item = await runtime.manager.dispatch('room.message.send', {
          roomId,
          input: { text: action.text, quotedItemId }
        })
        rememberItem(itemIds, action.key, item.id)
        continue
      }
      if (action.type === 'reply') {
        const itemId = requiredReference(itemIds, action.item, 'Reply item')
        await waitForItem(runtime.manager, roomId, itemId, waitTimeoutMs)
        await runtime.manager.dispatch('room.reply.send', {
          roomId,
          itemId,
          input: { text: action.text }
        })
        continue
      }
      if (action.type === 'reaction') {
        const itemId = requiredReference(itemIds, action.item, 'Reaction item')
        await waitForItem(runtime.manager, roomId, itemId, waitTimeoutMs)
        await runtime.manager.dispatch('room.item.react', { roomId, itemId, emoji: action.emoji })
        continue
      }
      if (action.type === 'poll') {
        const item = await runtime.manager.dispatch('room.poll.create', {
          roomId,
          input: { question: action.question, options: action.options.map((option) => option.label) }
        })
        rememberItem(itemIds, action.key, item.id)
        polls.set(action.key, {
          id: item.poll.id,
          options: new Map(action.options.map((option, index) => [option.key, item.poll.options[index].id]))
        })
        continue
      }
      if (action.type === 'vote') {
        const poll = polls.get(action.poll)
        if (!poll) throw new Error(`Vote references unknown poll ${action.poll}`)
        const optionId = poll.options.get(action.option)
        if (!optionId) throw new Error(`Vote references unknown option ${action.option}`)
        await waitForPoll(runtime.manager, roomId, poll.id, waitTimeoutMs)
        await runtime.manager.dispatch('room.poll.vote', { roomId, pollId: poll.id, option: optionId })
        continue
      }
      if (action.type === 'call') {
        const receipt = await submitHistoricalCall(runtime.manager, {
          roomId,
          callId: action.callId,
          optionId: action.option
        }, waitTimeoutMs)
        if (action.key) receipts.set(action.key, receipt.id)
      }
    }

    const expectedItems = normalized.actions.filter((action) => action.type === 'message' || action.type === 'quote' || action.type === 'poll').length
    let replicationSummary = []
    try {
      await waitFor(async () => {
        const states = await Promise.all([...actorMap.entries()].map(async ([actorId, { manager }]) => ({
          actorId,
          state: await manager.dispatch('room.state', { roomId })
        })))
        replicationSummary = states.map(({ actorId, state }) => ({ actorId, items: state.items.length, members: state.members.length }))
        return states.every(({ state }) =>
          state.items.length >= expectedItems &&
          state.members.length === normalized.personas.length &&
          [...itemIds.values()].every((itemId) => state.items.some((item) => item.id === itemId)) &&
          [...polls.values()].every((poll) => state.items.some((item) => item.kind === 'poll' && item.poll.id === poll.id))
        )
      }, 'final room replication', waitTimeoutMs)
    } catch (error) {
      throw new Error(`${error.message}; expected items=${expectedItems}, members=${normalized.personas.length}; observed=${JSON.stringify(replicationSummary)}`)
    }

    return {
      fixtureId: normalized.fixtureId,
      roomId,
      inviteCode: details.invite.code,
      itemIds: Object.fromEntries(itemIds),
      pollIds: Object.fromEntries([...polls].map(([key, poll]) => [key, poll.id])),
      receiptIds: Object.fromEntries(receipts),
      actionCount: normalized.actions.length,
      memberCount: normalized.personas.length,
      seededItemCount: expectedItems,
      projectedItemCount: replicationSummary[0]?.items ?? null
    }
  } finally {
    for (const runtime of actorMap.values()) runtime.clock.reset()
  }
}

function validateSeed (seed) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new TypeError('Historical room seed must be an object')
  if (seed.kind !== 'fulltime.showcase.roomSeed' || seed.schemaVersion !== 1) throw new TypeError('Historical room seed schema is unsupported')
  if (typeof seed.fixtureId !== 'string' || !KEY_PATTERN.test(seed.fixtureId)) throw new TypeError('Historical room fixture ID is invalid')
  if (!seed.room || typeof seed.room.name !== 'string' || seed.room.name.trim().length < 1) throw new TypeError('Historical room name is invalid')
  if (!Number.isSafeInteger(seed.room.createdAt) || seed.room.createdAt <= 0) throw new TypeError('Historical room creation timestamp is invalid')
  if (!Array.isArray(seed.personas) || seed.personas.length < 2) throw new TypeError('Historical room needs at least two personas')
  const personaIds = new Set()
  let creators = 0
  for (const persona of seed.personas) {
    if (!persona || typeof persona !== 'object' || !KEY_PATTERN.test(persona.id || '')) throw new TypeError('Historical room persona ID is invalid')
    if (personaIds.has(persona.id)) throw new TypeError(`Historical room persona ${persona.id} is duplicated`)
    personaIds.add(persona.id)
    if (typeof persona.displayName !== 'string' || persona.displayName.trim().length < 1) throw new TypeError(`Historical room persona ${persona.id} has no display name`)
    if (!Number.isSafeInteger(persona.joinedAt) || persona.joinedAt < seed.room.createdAt) throw new TypeError(`Historical room persona ${persona.id} has an invalid join timestamp`)
    if (persona.creator) creators++
  }
  if (creators !== 1) throw new TypeError('Historical room seed must have exactly one creator')
  if (!Array.isArray(seed.actions) || seed.actions.length < 1) throw new TypeError('Historical room seed needs actions')
  let priorTimestamp = seed.room.createdAt
  const actionKeys = new Set()
  for (const action of seed.actions) {
    if (!action || typeof action !== 'object' || !ACTION_TYPES.has(action.type)) throw new TypeError('Historical room action type is invalid')
    if (!personaIds.has(action.actor)) throw new TypeError(`Historical room action references unknown actor ${action.actor}`)
    if (!Number.isSafeInteger(action.at) || action.at < priorTimestamp) throw new TypeError('Historical room actions must be in timestamp order')
    priorTimestamp = action.at
    if (action.key) {
      if (!KEY_PATTERN.test(action.key) || actionKeys.has(action.key)) throw new TypeError(`Historical room action key ${action.key} is invalid or duplicated`)
      actionKeys.add(action.key)
    }
    if (action.type === 'message' || action.type === 'quote' || action.type === 'reply') requireText(action.text, `${action.type} text`)
    if ((action.type === 'quote' || action.type === 'reply' || action.type === 'reaction') && !KEY_PATTERN.test(action.item || '')) throw new TypeError(`${action.type} item reference is invalid`)
    if (action.type === 'reaction' && (typeof action.emoji !== 'string' || !REACTION_EMOJIS.has(action.emoji.trim()))) throw new TypeError('Reaction emoji is invalid')
    if (action.type === 'poll') validatePoll(action)
    if (action.type === 'vote' && (!KEY_PATTERN.test(action.poll || '') || !KEY_PATTERN.test(action.option || ''))) throw new TypeError('Vote reference is invalid')
    if (action.type === 'call' && (!KEY_PATTERN.test(action.key || '') || !KEY_PATTERN.test(action.callId || '') || !OPTION_PATTERN.test(action.option || ''))) throw new TypeError('Call action reference is invalid')
  }
  return seed
}

function validatePoll (action) {
  requireText(action.question, 'Poll question')
  if (!action.key) throw new TypeError('Poll action needs a key')
  if (!Array.isArray(action.options) || action.options.length < 2 || action.options.length > MAX_POLL_OPTIONS) throw new TypeError('Poll action options are invalid')
  const keys = new Set()
  for (const option of action.options) {
    if (!option || !KEY_PATTERN.test(option.key || '') || keys.has(option.key)) throw new TypeError('Poll option key is invalid or duplicated')
    keys.add(option.key)
    requireText(option.label, 'Poll option label')
  }
}

function normalizeActors (actors, personas) {
  const actorMap = actors instanceof Map ? actors : new Map(Object.entries(actors || {}))
  for (const persona of personas) {
    const runtime = actorMap.get(persona.id)
    if (!runtime?.manager || typeof runtime.manager.dispatch !== 'function') throw new TypeError(`Historical actor ${persona.id} needs a real room manager`)
    if (!runtime.clock || typeof runtime.clock.set !== 'function' || typeof runtime.clock.reset !== 'function') throw new TypeError(`Historical actor ${persona.id} needs a controllable operation clock`)
  }
  return actorMap
}

function setClock (runtime, timestamp) {
  runtime.clock.set(timestamp)
}

function rememberItem (items, key, id) {
  if (!key) return
  items.set(key, id)
}

function requiredReference (items, key, label) {
  const id = items.get(key)
  if (!id) throw new Error(`${label} ${key} has not been created`)
  return id
}

async function waitForItem (manager, roomId, itemId, timeoutMs) {
  await waitFor(async () => {
    const state = await manager.dispatch('room.state', { roomId })
    return state.items.some((item) => item.id === itemId)
  }, `item replication for ${itemId}`, timeoutMs)
}

async function waitForPoll (manager, roomId, pollId, timeoutMs) {
  await waitFor(async () => {
    const state = await manager.dispatch('room.state', { roomId })
    return state.items.some((item) => item.kind === 'poll' && item.poll.id === pollId)
  }, `poll replication for ${pollId}`, timeoutMs)
}

async function submitHistoricalCall (manager, payload, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      return await manager.dispatch('room.answer.submit', payload)
    } catch (error) {
      lastError = error
      if (!['CALL_FIXTURE_MISMATCH', 'CALL_UNKNOWN', 'FEED_UNAVAILABLE', 'RECEIPT_FEED_UNAVAILABLE'].includes(error?.code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`Timed out submitting historical call ${payload.callId}: ${lastError?.message || 'unavailable'}`)
}

async function waitFor (predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function requireText (value, label) {
  if (typeof value !== 'string' || value.trim().length < 1) throw new TypeError(`${label} is invalid`)
}

module.exports = {
  createHistoricalClock,
  seedHistoricalRoom,
  validateSeed
}
