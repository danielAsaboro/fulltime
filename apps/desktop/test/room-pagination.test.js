'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const Corestore = require('corestore')

const { createIdentity, userIdFromPublicKey } = require('../lib/room-identity.js')
const { validateJson } = require('../lib/room-protocol.js')
const {
  closeRoomView,
  openRoomView,
  projectHistoryPage,
  projectThreadPage,
  valueAt
} = require('../workers/room-view.js')

test('real Hyperbee cursor pages 10k items without drift when newer records arrive', { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-room-pages-'))
  const store = new Corestore(root)
  await store.ready()
  const view = openRoomView({ get: (name) => store.get({ name }) })
  await view.ready()
  const identityKeyPair = createIdentity().keyPair
  const userId = userIdFromPublicKey(identityKeyPair.publicKey)
  const roomId = 'room_pagination_1'

  try {
    const batch = view.batch()
    await batch.put('meta/room', {
      id: roomId,
      fixture: { id: 'fixture-pages', status: 'scheduled' },
      type: 'private',
      name: 'Pagination room',
      createdBy: userId,
      createdAt: 1,
      activeInviteId: null,
      memberCount: 1,
      sequence: 10_000,
      epoch: 1,
      slowModeSeconds: 0,
      isClosed: false
    })
    await batch.put(`member/${userId}`, {
      userId,
      displayName: 'Pager',
      role: 'creator',
      joinedAt: 1,
      active: true,
      banned: false
    })
    for (let sequence = 1; sequence <= 10_000; sequence++) {
      const id = itemId(sequence)
      await batch.put(`item/${sequenceKey(sequence)}/${id}`, {
        id,
        roomId,
        kind: 'system',
        text: `Event ${sequence}`,
        tone: 'info',
        createdAt: sequence,
        releaseAt: sequence
      })
    }
    await batch.flush()

    const first = await projectHistoryPage(view, { identityKeyPair, limit: 100 })
    validateJson(first)
    assert.equal(first.items.length, 100)
    assert.equal(Object.hasOwn(first.items[0], 'releaseAt'), false)
    assert.equal(first.items[0].id, itemId(10_000))
    assert.equal(first.items[99].id, itemId(9_901))
    assert.equal(first.hasMore, true)
    assert.ok(first.nextCursor)

    await view.put(`item/${sequenceKey(10_001)}/item-newest`, {
      id: 'item-newest',
      roomId,
      kind: 'system',
      text: 'Arrived after page one',
      tone: 'info',
      createdAt: 10_001,
      releaseAt: 10_001
    })
    const roomAfterInsert = await valueAt(view, 'meta/room')
    roomAfterInsert.sequence = 10_001
    await view.put('meta/room', roomAfterInsert)

    const second = await projectHistoryPage(view, {
      identityKeyPair,
      limit: 100,
      cursor: first.nextCursor
    })
    assert.equal(second.items[0].id, itemId(9_900))
    assert.equal(second.items[99].id, itemId(9_801))
    assert.equal(second.items.some((item) => item.id === 'item-newest'), false)

    const collected = first.items.map((item) => item.id)
    let page = second
    while (true) {
      collected.push(...page.items.map((item) => item.id))
      if (!page.nextCursor) break
      page = await projectHistoryPage(view, {
        identityKeyPair,
        limit: 100,
        cursor: page.nextCursor
      })
    }
    assert.equal(collected.length, 10_000)
    assert.equal(new Set(collected).size, 10_000)
    assert.equal(collected.includes('item-newest'), false)
    assert.equal(collected.at(-1), itemId(1))

    await assert.rejects(
      projectHistoryPage(view, { identityKeyPair, limit: 0 }),
      /limit must be an integer from 1 to 100/
    )
    await assert.rejects(
      projectHistoryPage(view, { identityKeyPair, limit: 101 }),
      /limit must be an integer from 1 to 100/
    )
    await assert.rejects(
      projectHistoryPage(view, { identityKeyPair, limit: 100, cursor: `${first.nextCursor.slice(0, -1)}!` }),
      /cursor/i
    )

    const savedRoom = await valueAt(view, 'meta/room')
    await view.put('meta/room', { ...savedRoom, id: 'room_pagination_2' })
    await assert.rejects(
      projectHistoryPage(view, { identityKeyPair, limit: 100, cursor: first.nextCursor }),
      /does not belong/i
    )
    await view.put('meta/room', { ...savedRoom, epoch: 2 })
    await assert.rejects(
      projectHistoryPage(view, { identityKeyPair, limit: 100, cursor: first.nextCursor }),
      /does not belong/i
    )
    await view.put('meta/room', savedRoom)

    const targetId = itemId(10_000)
    await view.put(`item-id/${targetId}`, { key: `item/${sequenceKey(10_000)}/${targetId}`, kind: 'system' })
    const replyBatch = view.batch()
    for (let sequence = 1; sequence <= 250; sequence++) {
      await replyBatch.put(`reply/${targetId}/${sequenceKey(20_000 + sequence)}/${replyId(sequence)}`, {
        id: replyId(sequence),
        itemId: targetId,
        roomId,
        authorId: userId,
        text: `Reply ${sequence}`,
        createdAt: sequence
      })
    }
    await replyBatch.flush()

    const threadFirst = await projectThreadPage(view, targetId, { identityKeyPair, limit: 100 })
    assert.equal(threadFirst.items[0].id, replyId(250))
    assert.equal(threadFirst.items[99].id, replyId(151))
    await view.put(`reply/${targetId}/${sequenceKey(20_251)}/reply-newest`, {
      id: 'reply-newest',
      itemId: targetId,
      roomId,
      authorId: userId,
      text: 'New reply',
      createdAt: 251
    })
    const threadSecond = await projectThreadPage(view, targetId, {
      identityKeyPair,
      limit: 100,
      cursor: threadFirst.nextCursor
    })
    assert.equal(threadSecond.items[0].id, replyId(150))
    assert.equal(threadSecond.items[99].id, replyId(51))
    assert.equal(threadSecond.items.some((reply) => reply.id === 'reply-newest'), false)
    await assert.rejects(
      projectThreadPage(view, targetId, { identityKeyPair, limit: 100, cursor: first.nextCursor }),
      /does not belong/i
    )
  } finally {
    await closeRoomView(view).catch(() => {})
    await store.close().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

function sequenceKey (sequence) {
  return String(sequence).padStart(16, '0')
}

function itemId (sequence) {
  return `item-${String(sequence).padStart(5, '0')}`
}

function replyId (sequence) {
  return `reply-${String(sequence).padStart(4, '0')}`
}
