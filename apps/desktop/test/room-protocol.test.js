'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  ROOM_IPC_VERSION,
  encodeRoomFrame,
  errorResponse,
  parseRoomFrame,
  validateEvent,
  validateRequest,
  validateResponse
} = require('../lib/room-protocol.js')

test('v2 room requests and responses are correlated, closed, and bounded', () => {
  const request = {
    version: ROOM_IPC_VERSION,
    id: 'request-123',
    action: 'room.message.send',
    payload: { roomId: 'room_abc', input: { text: 'hello' } }
  }
  assert.deepEqual(validateRequest(parseRoomFrame(Buffer.from(encodeRoomFrame(request)))), request)
  assert.equal(validateRequest({
    ...request,
    action: 'fixture.list',
    payload: { phase: 'live' }
  }).action, 'fixture.list')
  assert.equal(validateRequest({
    ...request,
    action: 'room.history.page',
    payload: { roomId: 'room_abc', limit: 100, cursor: null }
  }).action, 'room.history.page')
  assert.equal(validateRequest({
    ...request,
    action: 'room.thread.page',
    payload: { roomId: 'room_abc', itemId: 'item_abc', limit: 1 }
  }).action, 'room.thread.page')
  assert.equal(validateRequest({
    ...request,
    action: 'room.report',
    payload: {
      roomId: 'room_abc',
      target: { kind: 'member', id: 'peer_report_target' },
      reason: 'spam',
      note: ''
    }
  }).action, 'room.report')
  assert.equal(validateRequest({
    ...request,
    action: 'room.answer.submit',
    payload: { roomId: 'room_abc', callId: 'call_abc', optionId: 'home' }
  }).action, 'room.answer.submit')
  assert.equal(validateRequest({
    ...request,
    action: 'fixture.intelligence',
    payload: { fixtureId: 'fixture_abc' }
  }).action, 'fixture.intelligence')
  assert.equal(validateRequest({
    ...request,
    action: 'room.receipt.get',
    payload: { roomId: 'room_abc', receiptId: 'aat:service:1' }
  }).action, 'room.receipt.get')
  assert.equal(validateRequest({
    ...request,
    action: 'room.replay',
    payload: { roomId: 'room_abc' }
  }).action, 'room.replay')
  assert.throws(() => validateRequest({ ...request, action: 'room.destroy' }), /unsupported/i)
  for (const action of [
    'room.watch',
    'room.unwatch',
    'room.reaction.send',
    'room.note.send',
    'room.notifications.update',
    'room.legacy.get',
    'room.legacy.set'
  ]) {
    assert.throws(() => validateRequest({ ...request, action }), /unsupported/i)
  }
  assert.throws(() => validateRequest({ ...request, surprise: true }), /unsupported field/i)

  const response = { version: ROOM_IPC_VERSION, id: request.id, ok: true, result: { id: 'item_1' } }
  assert.deepEqual(validateResponse(response), response)
  assert.throws(() => validateResponse({ ...response, result: undefined }), /JSON values|result/i)

  const failed = errorResponse(request.id, Object.assign(new Error('No write access'), { code: 'NOT_WRITABLE' }))
  assert.equal(validateResponse(failed).error.code, 'NOT_WRITABLE')
  assert.equal(failed.error.recoverable, true)
})

test('v2 room events accept production projections and reject non-JSON state', () => {
  assert.equal(validateEvent({
    version: ROOM_IPC_VERSION,
    type: 'transport.status',
    status: 'online',
    peerCount: 2,
    at: 1
  }).peerCount, 2)
  assert.equal(validateEvent({
    version: ROOM_IPC_VERSION,
    type: 'fixture.updated',
    fixtureId: 'fixture-1',
    card: { fixture: { id: 'fixture-1' }, phase: 'upcoming' },
    at: 1
  }).fixtureId, 'fixture-1')
  assert.throws(() => validateEvent({
    version: ROOM_IPC_VERSION,
    type: 'room.state',
    roomId: 'room_abc',
    revision: 1,
    state: { value: BigInt(1) },
    at: 1
  }), /JSON values/i)
})
