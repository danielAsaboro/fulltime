'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { validateEvent, validateJson } = require('../lib/room-protocol.js')
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

test('room manager materializes shared response objects at the JSON IPC boundary', async () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-response-test',
    displayName: 'IPC response test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 12),
    notificationsEnabled: false
  })
  const shared = { id: 'fixture_123', home: { name: 'Spain' }, away: { name: 'France' } }
  manager._dispatch = async () => ({ fixture: shared, pinnedFixture: shared })

  const result = await manager.dispatch('fixture.list', null)

  assert.doesNotThrow(() => validateJson(result))
  assert.deepEqual(result.fixture, shared)
  assert.deepEqual(result.pinnedFixture, shared)
  assert.notStrictEqual(result.fixture, result.pinnedFixture)
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

test('persisted room catalog renders verified fixture summaries without eagerly opening Autobases', async () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-lazy-catalog-test',
    displayName: 'Lazy catalog test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 10),
    notificationsEnabled: false
  })
  const fixture = {
    id: 'fixture_2026',
    status: 'scheduled',
    home: { name: 'Spain' },
    away: { name: 'Argentina' }
  }
  manager.fixturePlane = { requireFixture: (fixtureId) => {
    assert.equal(fixtureId, fixture.id)
    return fixture
  } }
  manager.roomRecords.set('room_lazy2026', {
    roomId: 'room_lazy2026',
    fixtureId: fixture.id,
    joinedAt: 1
  })

  const rooms = await manager.listRooms()
  assert.equal(manager.rooms.size, 0)
  assert.deepEqual(rooms, [{
    room: {
      id: 'room_lazy2026',
      fixtureId: fixture.id,
      type: 'private',
      name: 'Private room'
    },
    fixture,
    phase: 'upcoming',
    members: 0,
    loading: true
  }])
})

test('room catalog puts the latest fixture first so knockout and final rooms stay visible', async () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-catalog-order-test',
    displayName: 'Catalog order test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 14),
    notificationsEnabled: false
  })
  manager.roomRecords.set('room_group', { roomId: 'room_group', fixtureId: 'group' })
  manager.roomRecords.set('room_final', { roomId: 'room_final', fixtureId: 'final' })
  manager.roomCatalog.set('room_group', {
    room: { id: 'room_group' },
    fixture: { id: 'group', kickoff: 100 }
  })
  manager.roomCatalog.set('room_final', {
    room: { id: 'room_final' },
    fixture: { id: 'final', kickoff: 200 }
  })

  const rooms = await manager.listRooms()
  assert.deepEqual(rooms.map((room) => room.room.id), ['room_final', 'room_group'])
})

test('concurrent lazy room access deduplicates the real encrypted open', async () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-lazy-open-test',
    displayName: 'Lazy open test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 11),
    notificationsEnabled: false
  })
  const record = { roomId: 'room_lazyopen', fixtureId: 'fixture_2026' }
  const room = { roomId: record.roomId }
  let opens = 0
  manager.roomRecords.set(record.roomId, record)
  manager._openRecord = async (received) => {
    opens++
    assert.equal(received, record)
    await new Promise((resolve) => setTimeout(resolve, 10))
    manager.rooms.set(record.roomId, room)
    return room
  }

  const [first, second] = await Promise.all([
    manager.ensureRoom(record.roomId),
    manager.ensureRoom(record.roomId)
  ])
  assert.equal(first, room)
  assert.equal(second, room)
  assert.equal(opens, 1)
  assert.equal(manager.openingRooms.size, 0)
})

test('room manager evicts the least-recently-used idle handle without losing its persisted catalog', async () => {
  const manager = new RoomManager({
    storagePath: '/tmp/fulltime-room-manager-capacity-test',
    displayName: 'Capacity test',
    fixtureFeedKey: '00'.repeat(32),
    deviceSecret: Buffer.alloc(32, 13),
    notificationsEnabled: false,
    openPersistedRooms: false
  })
  manager.presence = { removeRoom: async () => {} }
  const closed = []
  for (let index = 0; index < 6; index++) {
    const roomId = `room_capacity${index}`
    manager.rooms.set(roomId, { close: async () => { closed.push(roomId) } })
    manager.roomRecords.set(roomId, { roomId, fixtureId: `fixture_${index}` })
    manager.roomCatalog.set(roomId, { room: { id: roomId } })
    manager.roomLastUsed.set(roomId, index + 1)
  }
  manager._acquireRoomLease('room_capacity0')

  await manager._makeRoomCapacity('room_incoming')

  assert.deepEqual(closed, ['room_capacity1'])
  assert.equal(manager.rooms.has('room_capacity1'), false)
  assert.equal(manager.roomRecords.has('room_capacity1'), true)
  assert.equal(manager.roomCatalog.has('room_capacity1'), true)
  assert.equal(manager.rooms.has('room_capacity0'), true)
})
