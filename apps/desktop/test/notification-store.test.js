'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Corestore = require('corestore')

const { NotificationStore } = require('../workers/notification-store.js')

function intent (overrides = {}) {
  return {
    id: 'notification-message-1',
    sourceId: 'item-message-1',
    roomId: 'room-secure-1',
    category: 'message',
    title: 'Ada in France v Morocco',
    body: 'Goal!',
    target: { roomId: 'room-secure-1', itemId: 'item-message-1' },
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

test('notification intents persist, deduplicate, and require real lifecycle acknowledgements', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fulltime-notifications-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  let rootStore = new Corestore(directory)
  let store = new NotificationStore(rootStore)
  await store.ready()
  const first = await store.enqueue(intent())
  assert.equal(first.state, 'queued')
  assert.deepEqual(await store.enqueue(intent()), first)
  assert.equal((await store.pending()).length, 1)
  await store.close()
  await rootStore.close()

  rootStore = new Corestore(directory)
  store = new NotificationStore(rootStore)
  await store.ready()
  assert.equal((await store.pending())[0].id, first.id)
  const presented = await store.transition(first.id, 'presented', first.createdAt + 1)
  assert.equal(presented.state, 'presented')
  assert.deepEqual(await store.pending(), [])
  const opened = await store.transition(first.id, 'opened', first.createdAt + 2)
  assert.equal(opened.state, 'opened')
  await assert.rejects(store.transition(first.id, 'dismissed', first.createdAt + 3), /cannot transition/)
  await store.close()
  await rootStore.close()
})

test('disabled categories do not produce fake queued notifications', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fulltime-notification-settings-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const rootStore = new Corestore(directory)
  const store = new NotificationStore(rootStore)
  await store.ready()
  await store.updateSettings('room-secure-1', { messages: false })
  assert.equal(await store.enqueue(intent()), null)
  assert.deepEqual(await store.pending(), [])
  await store.close()
  await rootStore.close()
})
