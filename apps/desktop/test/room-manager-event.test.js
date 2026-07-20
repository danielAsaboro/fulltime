'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { validateEvent } = require('../lib/room-protocol.js')
const { RoomManager } = require('../workers/room-manager.js')

test('room manager materializes shared projection objects at the JSON IPC boundary', () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-event-test',
    displayName: 'IPC test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 7),
    notificationsEnabled: false
  })
  const shared = { id: 'fixture_123', home: { name: 'Spain' }, away: { name: 'France' } }
  let emitted = null
  manager.on('event', (event) => { emitted = event })

  manager._emit({
    type: 'room.state',
    roomId: 'room_abc12345',
    revision: 1,
    state: { fixture: shared, pinnedFixture: shared },
    at: 1
  })

  assert.doesNotThrow(() => validateEvent(emitted))
  assert.deepEqual(emitted.state.fixture, shared)
  assert.deepEqual(emitted.state.pinnedFixture, shared)
  assert.notStrictEqual(emitted.state.fixture, emitted.state.pinnedFixture)
})

test('room manager validates the persisted-room startup policy', () => {
  assert.throws(() => new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-startup-policy-test',
    displayName: 'Operator test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 8),
    notificationsEnabled: false,
    openPersistedRooms: 'no'
  }), /openPersistedRooms must be a boolean/)
})

test('suspending a room closes its live handle without deleting its account record', async () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-suspend-test',
    displayName: 'Operator test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 9),
    notificationsEnabled: false,
    openPersistedRooms: false
  })
  let closed = false
  manager.presence = { removeRoom: async () => {} }
  manager.rooms.set('room_operator', { close: async () => { closed = true } })

  assert.equal(await manager.suspendRoom('room_operator'), true)
  assert.equal(closed, true)
  assert.equal(manager.rooms.has('room_operator'), false)
  assert.equal(await manager.suspendRoom('room_operator'), false)
})
