'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8')

function loadPreload(invoke = () => Promise.resolve()) {
  let exposedApi
  let eventHandler
  const loggedErrors = []
  const contextBridge = {
    exposeInMainWorld(name, api) {
      assert.equal(name, 'fullTimePeers')
      exposedApi = api
    }
  }
  const ipcRenderer = {
    invoke(channel, payload) {
      return invoke(channel, payload)
    },
    on(channel, handler) {
      assert.equal(channel, 'fulltime-peers:event')
      eventHandler = handler
    }
  }
  const context = vm.createContext({
    console: { error: (...args) => loggedErrors.push(args) },
    require(id) {
      assert.equal(id, 'electron')
      return { contextBridge, ipcRenderer }
    }
  })
  vm.runInContext(preloadSource, context, { filename: 'preload.js' })
  return { api: exposedApi, context, dispatch: (payload) => eventHandler({}, payload), loggedErrors }
}

test('production room requests correlate v2 responses and surface worker errors', async () => {
  const calls = []
  let loaded
  loaded = loadPreload(async (channel, request) => {
    calls.push({ channel, request })
    const response = vm.runInContext('({ version: 2, id: "", ok: true, result: null })', loaded.context)
    response.id = request.id
    if (request.action === 'room.get') {
      response.result = vm.runInContext(`({ room: { id: ${JSON.stringify(request.payload.roomId)} } })`, loaded.context)
      return response
    }
    if (request.action === 'fixture.list') {
      response.result = vm.runInContext('([{ fixture: { id: "fixture-1" }, phase: "upcoming" }])', loaded.context)
      return response
    }
    if (request.action === 'room.list') {
      response.result = vm.runInContext('([{ room: { id: "room_abc" } }])', loaded.context)
      return response
    }
    response.ok = false
    delete response.result
    response.error = vm.runInContext('({ code: "NOT_WRITABLE", message: "No write access", recoverable: false })', loaded.context)
    return response
  })
  const { api, context } = loaded

  const room = await api.request('room.get', vm.runInContext('({ roomId: "room_abc" })', context))
  assert.equal(room.room.id, 'room_abc')
  const fixtures = await api.request('fixture.list', vm.runInContext('({ phase: "upcoming" })', context))
  assert.equal(fixtures[0].fixture.id, 'fixture-1')
  const rooms = await api.request('room.list', null)
  assert.equal(rooms[0].room.id, 'room_abc')
  assert.equal(calls[0].channel, 'fulltime-peers:request')
  assert.match(calls[0].request.id, /^request-/)
  assert.equal(api.send, undefined)
  await assert.rejects(api.request('room.legacy.get', vm.runInContext('({ roomId: "room_abc" })', context)), /Unknown room action/)
  await assert.rejects(api.request('room.close', vm.runInContext('({ roomId: "room_abc" })', context)), (error) => {
    return error.code === 'NOT_WRITABLE' && error.message === 'No write access'
  })
  await assert.rejects(api.request('room.destroy', null), /Unknown room action/)
})

test('configuration unavailability crosses preload without Electron IPC wrapper text', async () => {
  const { api } = loadPreload(async (channel) => {
    assert.equal(channel, 'fulltime-peers:get-config')
    return {
      ok: false,
      error: {
        code: 'CONFIGURATION_UNAVAILABLE',
        message: 'FullTime network configuration is unavailable.'
      }
    }
  })

  await assert.rejects(api.getConfig(), (error) => {
    return error.code === 'CONFIGURATION_UNAVAILABLE' &&
      error.message === 'FullTime network configuration is unavailable.'
  })
})

test('a throwing renderer subscriber does not interrupt the other subscribers', () => {
  const { api, dispatch, loggedErrors } = loadPreload()
  const payload = { version: 2, type: 'transport.status', status: 'online', peerCount: 2, at: 1 }
  let received

  api.subscribe(() => {
    throw new Error('subscriber failed')
  })
  api.subscribe((event) => {
    received = event
  })

  assert.doesNotThrow(() => dispatch(payload))
  assert.equal(received, payload)
  assert.equal(loggedErrors.length, 1)
})

test('a throwing first subscriber cannot make backlog delivery escape subscribe', () => {
  const { api, dispatch, loggedErrors } = loadPreload()
  dispatch({ version: 2, type: 'bridge.ready', mode: 'pear-p2p-rooms', at: 1 })

  assert.doesNotThrow(() => {
    api.subscribe(() => {
      throw new Error('backlog subscriber failed')
    })
  })
  assert.equal(loggedErrors.length, 1)
})
