'use strict'

const NOTIFICATION_SCHEMA_VERSION = 1
const NOTIFICATION_LIFECYCLE_VERSION = 1
const NOTIFICATION_LIFECYCLE_TYPE = 'notification.lifecycle'
const NOTIFICATION_CATEGORIES = new Set(['call', 'message', 'moderation'])
const LIFECYCLE_STATES = new Set(['presented', 'opened', 'dismissed', 'failed'])
const TERMINAL_STATES = new Set(['opened', 'dismissed', 'failed'])
const ID_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

class NotificationLifecycle {
  constructor (value) {
    this.intent = validateQueuedNotificationIntent(value)
    this.state = 'queued'
    this.lastAt = null
  }

  transition (nextState, at = Date.now(), failure = null) {
    if (!LIFECYCLE_STATES.has(nextState)) throw new TypeError('Notification lifecycle state is unsupported')
    if (TERMINAL_STATES.has(this.state)) return null
    if (this.state === nextState) return null
    const allowed = this.state === 'queued'
      ? new Set(['presented', 'failed'])
      : new Set(['opened', 'dismissed', 'failed'])
    if (!allowed.has(nextState)) {
      throw new Error(`Notification lifecycle cannot transition from ${this.state} to ${nextState}`)
    }
    timestamp(at, 'Notification lifecycle timestamp')
    if (this.lastAt !== null && at < this.lastAt) {
      throw new TypeError('Notification lifecycle timestamp moved backwards')
    }
    const normalizedFailure = nextState === 'failed'
      ? boundedText(failure, 'Notification lifecycle failure', 1, 512)
      : null
    if (nextState !== 'failed' && failure !== null) {
      throw new TypeError('Successful notification lifecycle events cannot have a failure')
    }
    const event = validateLifecycleEvent({
      version: NOTIFICATION_LIFECYCLE_VERSION,
      type: NOTIFICATION_LIFECYCLE_TYPE,
      id: this.intent.id,
      roomId: this.intent.roomId,
      state: nextState,
      at,
      failure: normalizedFailure
    })
    this.state = nextState
    this.lastAt = at
    return event
  }
}

function validateQueuedNotificationIntent (value) {
  plainObject(value, 'Notification intent')
  exactKeys(value, [
    'version', 'id', 'sourceId', 'roomId', 'category', 'title', 'body', 'target',
    'createdAt', 'state', 'presentedAt', 'resolvedAt', 'failure'
  ], 'Notification intent')
  if (value.version !== NOTIFICATION_SCHEMA_VERSION) throw new TypeError('Notification intent version is unsupported')
  const id = identifier(value.id, 'Notification ID')
  const sourceId = identifier(value.sourceId, 'Notification source ID')
  const roomId = identifier(value.roomId, 'Notification room')
  if (!NOTIFICATION_CATEGORIES.has(value.category)) throw new TypeError('Notification category is unsupported')
  const title = boundedText(value.title, 'Notification title', 1, 80)
  const body = boundedText(value.body, 'Notification body', 1, 240)
  plainObject(value.target, 'Notification target')
  exactKeys(value.target, ['roomId', 'itemId'], 'Notification target')
  if (value.target.roomId !== roomId) throw new TypeError('Notification target room does not match')
  const itemId = value.target.itemId === null
    ? null
    : identifier(value.target.itemId, 'Notification target item')
  timestamp(value.createdAt, 'Notification createdAt')
  if (value.state !== 'queued' || value.presentedAt !== null || value.resolvedAt !== null || value.failure !== null) {
    throw new TypeError('Notification presenter accepts queued durable intents only')
  }
  return Object.freeze({
    version: NOTIFICATION_SCHEMA_VERSION,
    id,
    sourceId,
    roomId,
    category: value.category,
    title,
    body,
    target: Object.freeze({ roomId, itemId }),
    createdAt: value.createdAt,
    state: 'queued',
    presentedAt: null,
    resolvedAt: null,
    failure: null
  })
}

function validateLifecycleEvent (value) {
  plainObject(value, 'Notification lifecycle event')
  exactKeys(value, ['version', 'type', 'id', 'roomId', 'state', 'at', 'failure'], 'Notification lifecycle event')
  if (value.version !== NOTIFICATION_LIFECYCLE_VERSION || value.type !== NOTIFICATION_LIFECYCLE_TYPE) {
    throw new TypeError('Notification lifecycle event version is unsupported')
  }
  const id = identifier(value.id, 'Notification ID')
  const roomId = identifier(value.roomId, 'Notification room')
  if (!LIFECYCLE_STATES.has(value.state)) throw new TypeError('Notification lifecycle state is unsupported')
  timestamp(value.at, 'Notification lifecycle timestamp')
  const failure = value.state === 'failed'
    ? boundedText(value.failure, 'Notification lifecycle failure', 1, 512)
    : value.failure
  if (value.state !== 'failed' && failure !== null) {
    throw new TypeError('Successful notification lifecycle events cannot have a failure')
  }
  return Object.freeze({
    version: NOTIFICATION_LIFECYCLE_VERSION,
    type: NOTIFICATION_LIFECYCLE_TYPE,
    id,
    roomId,
    state: value.state,
    at: value.at,
    failure
  })
}

function sanitizeNotificationFailure (value, fallback = 'Native notification presentation failed') {
  let text = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value || '')
  text = text.normalize('NFC').replace(UNSAFE_TEXT, ' ').trim().slice(0, 512)
  if (!text) text = fallback
  return boundedText(text, 'Notification lifecycle failure', 1, 512)
}

function intentsEqual (left, right) {
  const first = validateQueuedNotificationIntent(left)
  const second = validateQueuedNotificationIntent(right)
  return first.version === second.version && first.id === second.id && first.sourceId === second.sourceId &&
    first.roomId === second.roomId && first.category === second.category && first.title === second.title &&
    first.body === second.body && first.target.roomId === second.target.roomId &&
    first.target.itemId === second.target.itemId && first.createdAt === second.createdAt
}

function boundedText (value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum ||
      value.normalize('NFC') !== value || UNSAFE_TEXT.test(value)) {
    throw new TypeError(`${label} must be ${minimum}-${maximum} safe characters`)
  }
  return value
}

function timestamp (value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} is invalid`)
  return value
}

function identifier (value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

function plainObject (value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value
}

function exactKeys (value, expected, label) {
  const keys = Object.keys(value)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new TypeError(`${label} has an invalid schema`)
  }
}

module.exports = {
  LIFECYCLE_STATES,
  NOTIFICATION_LIFECYCLE_TYPE,
  NOTIFICATION_LIFECYCLE_VERSION,
  NotificationLifecycle,
  intentsEqual,
  sanitizeNotificationFailure,
  validateLifecycleEvent,
  validateQueuedNotificationIntent
}
