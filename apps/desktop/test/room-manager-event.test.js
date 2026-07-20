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
