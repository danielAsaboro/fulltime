'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  NotificationLifecycle,
  intentsEqual,
  sanitizeNotificationFailure,
  validateLifecycleEvent,
  validateQueuedNotificationIntent
} = require('../lib/notification-lifecycle.js')
const { validateIntent } = require('../workers/notification-store.js')

function durableIntent (overrides = {}) {
  return {
    version: 1,
    id: 'notification-message-1',
    sourceId: 'item-message-1',
    roomId: 'room-secure-1',
    category: 'message',
    title: 'Ada in France v Morocco',
    body: 'Goal!',
    target: { roomId: 'room-secure-1', itemId: 'item-message-1' },
    createdAt: 1_700_000_000_000,
    state: 'queued',
    presentedAt: null,
    resolvedAt: null,
    failure: null,
    ...overrides
  }
}

test('presenter validation accepts the exact queued NotificationStore contract', () => {
  const stored = validateIntent(durableIntent())
  assert.deepEqual(validateQueuedNotificationIntent(stored), stored)
  assert.equal(Object.isFrozen(validateQueuedNotificationIntent(stored)), true)

  assert.throws(() => validateQueuedNotificationIntent({ ...stored, extra: true }), /invalid schema/)
  assert.throws(() => validateQueuedNotificationIntent({
    ...stored,
    state: 'presented',
    presentedAt: stored.createdAt + 1
  }), /queued durable intents only/)
  assert.throws(() => validateQueuedNotificationIntent({
    ...stored,
    target: { ...stored.target, roomId: 'room-other' }
  }), /does not match/)
  assert.throws(() => validateQueuedNotificationIntent({ ...stored, title: 'Unsafe\u202ename' }), /safe characters/)
})

test('pure lifecycle emits persistable transitions only in durable store order', () => {
  const lifecycle = new NotificationLifecycle(durableIntent())
  const presented = lifecycle.transition('presented', 1_700_000_000_001)
  assert.deepEqual(presented, {
    version: 1,
    type: 'notification.lifecycle',
    id: 'notification-message-1',
    roomId: 'room-secure-1',
    state: 'presented',
    at: 1_700_000_000_001,
    failure: null
  })
  assert.deepEqual(validateLifecycleEvent(presented), presented)
  assert.equal(Object.isFrozen(presented), true)

  const opened = lifecycle.transition('opened', 1_700_000_000_002)
  assert.equal(opened.state, 'opened')
  assert.equal(lifecycle.transition('dismissed', 1_700_000_000_003), null)
  assert.equal(lifecycle.transition('opened', 1_700_000_000_003), null)

  const invalid = new NotificationLifecycle(durableIntent({ id: 'notification-invalid-order' }))
  assert.throws(() => invalid.transition('dismissed', 1), /cannot transition/)
  invalid.transition('presented', 10)
  assert.throws(() => invalid.transition('opened', 9), /moved backwards/)
})

test('failure lifecycle is terminal, bounded, and distinct from successful presentation', () => {
  const lifecycle = new NotificationLifecycle(durableIntent({ id: 'notification-failure-1' }))
  const message = sanitizeNotificationFailure(new Error('OS failed\u0000to show'))
  assert.equal(message, 'OS failed to show')
  const failed = lifecycle.transition('failed', 1_700_000_000_010, message)
  assert.deepEqual(failed, {
    version: 1,
    type: 'notification.lifecycle',
    id: 'notification-failure-1',
    roomId: 'room-secure-1',
    state: 'failed',
    at: 1_700_000_000_010,
    failure: 'OS failed to show'
  })
  assert.equal(lifecycle.transition('presented', 1_700_000_000_011), null)
  assert.throws(() => validateLifecycleEvent({ ...failed, failure: null }), /safe characters/)
  assert.throws(() => validateLifecycleEvent({ ...failed, state: 'presented' }), /cannot have a failure/)

  const afterPresentation = new NotificationLifecycle(durableIntent({ id: 'notification-failure-2' }))
  afterPresentation.transition('presented', 20)
  assert.equal(afterPresentation.transition('failed', 21, 'Native notification service disconnected').state, 'failed')
})

test('dismissal is emitted only after an acknowledged presentation', () => {
  const lifecycle = new NotificationLifecycle(durableIntent({ id: 'notification-dismissed-1' }))
  lifecycle.transition('presented', 30)
  const dismissed = lifecycle.transition('dismissed', 31)
  assert.equal(dismissed.state, 'dismissed')
  assert.equal(dismissed.failure, null)
  assert.equal(lifecycle.transition('opened', 32), null)
})

test('active intent equality binds all durable display and navigation fields', () => {
  const first = durableIntent()
  assert.equal(intentsEqual(first, durableIntent()), true)
  assert.equal(intentsEqual(first, durableIntent({ body: 'Different body' })), false)
  assert.equal(intentsEqual(first, durableIntent({
    target: { roomId: 'room-secure-1', itemId: 'item-message-2' }
  })), false)
})
