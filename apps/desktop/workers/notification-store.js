'use strict'

const Hyperbee = require('hyperbee')

const NOTIFICATION_SCHEMA_VERSION = 1
const NOTIFICATION_CATEGORIES = new Set(['call', 'message', 'moderation'])
const NOTIFICATION_STATES = new Set(['queued', 'presented', 'opened', 'dismissed', 'failed'])
const ID_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
const MAX_PENDING_NOTIFICATIONS = 100

class NotificationStore {
  constructor (rootStore) {
    this.store = rootStore.namespace('fulltime-local-notifications-v1')
    this.db = new Hyperbee(this.store.get({ name: 'notifications' }), {
      extension: false,
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
  }

  ready () {
    return this.db.ready()
  }

  async settings (roomId) {
    identifier(roomId, 'Notification room')
    const entry = await this.db.get(`settings/${roomId}`)
    if (!entry) return defaultSettings(roomId)
    return validateSettings(entry.value, roomId)
  }

  async updateSettings (roomId, patch) {
    identifier(roomId, 'Notification room')
    plainObject(patch, 'Notification settings patch')
    const allowed = ['calls', 'messages', 'moderation']
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key) || typeof patch[key] !== 'boolean') {
        throw new TypeError(`Notification setting ${key} is unsupported`)
      }
    }
    const current = await this.settings(roomId)
    const next = validateSettings({ ...current, ...patch, updatedAt: Date.now() }, roomId)
    await this.db.put(`settings/${roomId}`, next)
    return next
  }

  async enqueue (input) {
    const intent = validateIntent({
      ...input,
      version: NOTIFICATION_SCHEMA_VERSION,
      state: 'queued',
      presentedAt: null,
      resolvedAt: null,
      failure: null
    })
    const categorySetting = intent.category === 'call'
      ? 'calls'
      : intent.category === 'message' ? 'messages' : 'moderation'
    const settings = await this.settings(intent.roomId)
    if (!settings[categorySetting]) return null
    const key = `intent/${intent.id}`
    const existing = await this.db.get(key)
    if (existing) return validateIntent(existing.value)
    await this.db.put(key, intent)
    await this.db.put(queueKey(intent), { id: intent.id })
    return intent
  }

  async pending ({ limit = 50 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PENDING_NOTIFICATIONS) {
      throw new TypeError(`Pending notification limit must be 1-${MAX_PENDING_NOTIFICATIONS}`)
    }
    const intents = []
    for await (const entry of this.db.createReadStream({
      gte: 'queue/',
      lt: 'queue/\xff',
      limit
    })) {
      const stored = await this.db.get(`intent/${entry.value.id}`)
      if (!stored) throw new Error(`Notification queue references missing intent ${entry.value.id}`)
      const intent = validateIntent(stored.value)
      if (intent.state !== 'queued') throw new Error(`Notification queue contains resolved intent ${intent.id}`)
      intents.push(intent)
    }
    return intents
  }

  async transition (id, state, at = Date.now(), failure = null) {
    identifier(id, 'Notification ID')
    if (!NOTIFICATION_STATES.has(state) || state === 'queued') {
      throw new TypeError('Notification transition state is unsupported')
    }
    if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('Notification transition timestamp is invalid')
    const key = `intent/${id}`
    const entry = await this.db.get(key)
    if (!entry) throw new Error('Notification intent was not found')
    const current = validateIntent(entry.value)
    if (current.state === state) return current
    const allowed = current.state === 'queued'
      ? new Set(['presented', 'failed'])
      : current.state === 'presented'
        ? new Set(['opened', 'dismissed', 'failed'])
        : new Set()
    if (!allowed.has(state)) throw new Error(`Notification cannot transition from ${current.state} to ${state}`)
    const normalizedFailure = state === 'failed' ? boundedText(failure, 'Notification failure', 1, 512) : null
    const next = validateIntent({
      ...current,
      state,
      presentedAt: state === 'presented' ? at : current.presentedAt,
      resolvedAt: state === 'presented' ? null : at,
      failure: normalizedFailure
    })
    const batch = this.db.batch()
    await batch.put(key, next)
    if (current.state === 'queued') await batch.del(queueKey(current))
    await batch.flush()
    return next
  }

  async get (id) {
    identifier(id, 'Notification ID')
    const entry = await this.db.get(`intent/${id}`)
    return entry ? validateIntent(entry.value) : null
  }

  async close () {
    await this.db.close()
    await this.store.close()
  }
}

function validateSettings (value, roomId) {
  plainObject(value, 'Notification settings')
  exactKeys(value, ['version', 'roomId', 'calls', 'messages', 'moderation', 'updatedAt'], 'Notification settings')
  if (value.version !== NOTIFICATION_SCHEMA_VERSION || value.roomId !== roomId) {
    throw new TypeError('Notification settings identity is invalid')
  }
  for (const key of ['calls', 'messages', 'moderation']) {
    if (typeof value[key] !== 'boolean') throw new TypeError(`Notification setting ${key} must be boolean`)
  }
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw new TypeError('Notification settings timestamp is invalid')
  }
  return value
}

function defaultSettings (roomId) {
  return {
    version: NOTIFICATION_SCHEMA_VERSION,
    roomId,
    calls: true,
    messages: true,
    moderation: true,
    updatedAt: 0
  }
}

function validateIntent (value) {
  plainObject(value, 'Notification intent')
  exactKeys(value, [
    'version', 'id', 'sourceId', 'roomId', 'category', 'title', 'body', 'target',
    'createdAt', 'state', 'presentedAt', 'resolvedAt', 'failure'
  ], 'Notification intent')
  if (value.version !== NOTIFICATION_SCHEMA_VERSION) throw new TypeError('Notification intent version is unsupported')
  identifier(value.id, 'Notification ID')
  identifier(value.sourceId, 'Notification source ID')
  identifier(value.roomId, 'Notification room')
  if (!NOTIFICATION_CATEGORIES.has(value.category)) throw new TypeError('Notification category is unsupported')
  boundedText(value.title, 'Notification title', 1, 80)
  boundedText(value.body, 'Notification body', 1, 240)
  plainObject(value.target, 'Notification target')
  exactKeys(value.target, ['roomId', 'itemId'], 'Notification target')
  if (value.target.roomId !== value.roomId) throw new TypeError('Notification target room does not match')
  if (value.target.itemId !== null) identifier(value.target.itemId, 'Notification target item')
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new TypeError('Notification createdAt is invalid')
  if (!NOTIFICATION_STATES.has(value.state)) throw new TypeError('Notification state is unsupported')
  nullableTimestamp(value.presentedAt, 'Notification presentedAt')
  nullableTimestamp(value.resolvedAt, 'Notification resolvedAt')
  if (value.failure !== null) boundedText(value.failure, 'Notification failure', 1, 512)
  if (value.state === 'queued' && (value.presentedAt !== null || value.resolvedAt !== null || value.failure !== null)) {
    throw new TypeError('Queued notification cannot have presentation state')
  }
  if (value.state === 'presented' && (value.presentedAt === null || value.resolvedAt !== null || value.failure !== null)) {
    throw new TypeError('Presented notification state is invalid')
  }
  if (['opened', 'dismissed'].includes(value.state) &&
      (value.presentedAt === null || value.resolvedAt === null || value.failure !== null)) {
    throw new TypeError('Resolved notification state is invalid')
  }
  if (value.state === 'failed' && (value.resolvedAt === null || value.failure === null)) {
    throw new TypeError('Failed notification state is invalid')
  }
  return value
}

function queueKey (intent) {
  return `queue/${String(intent.createdAt).padStart(16, '0')}/${intent.id}`
}

function boundedText (value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum ||
      value.normalize('NFC') !== value || UNSAFE_TEXT.test(value)) {
    throw new TypeError(`${label} must be ${minimum}-${maximum} safe characters`)
  }
  return value
}

function nullableTimestamp (value, label) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`${label} is invalid`)
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
  MAX_PENDING_NOTIFICATIONS,
  NOTIFICATION_SCHEMA_VERSION,
  NotificationStore,
  defaultSettings,
  validateIntent
}
