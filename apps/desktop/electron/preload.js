'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const EVENT_CHANNEL = 'fulltime-peers:event'
const subscribers = new Set()
const backlog = []
const MAX_BACKLOG = 100
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_JSON_DEPTH = 16
const MAX_JSON_NODES = 20_000
const ROOM_ACTIONS = new Set([
  'session.get',
  'session.sign-in',
  'session.sign-out',
  'fixture.list',
  'fixture.get',
  'fixture.intelligence',
  'record.get',
  'room.list',
  'room.get',
  'room.preview-invite',
  'room.create',
  'room.join',
  'room.details',
  'room.state',
  'room.answer.submit',
  'room.receipt.get',
  'room.replay',
  'room.history.page',
  'room.thread.page',
  'room.poll.vote',
  'room.message.send',
  'room.media.upload.begin',
  'room.media.upload.chunk',
  'room.media.upload.commit',
  'room.media.upload.abort',
  'room.media.download.begin',
  'room.media.download.chunk',
  'room.media.download.close',
  'room.notification.settings',
  'room.notification.settings.update',
  'room.report',
  'room.reports.list',
  'room.poll.create',
  'room.item.react',
  'room.reply.send',
  'room.typing.set',
  'room.read.mark',
  'room.invite.create',
  'room.invite.regenerate',
  'room.invite.revoke',
  'room.rename',
  'room.member.remove',
  'room.member.role',
  'room.slow-mode',
  'room.close',
  'room.leave',
])

let requestCounter = 0

function utf8ByteLength(value) {
  let length = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) length++
    else if (code < 0x800) length += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4
        index++
      } else length += 3
    } else length += 3
  }
  return length
}

function nextRequestId() {
  requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER
  return `request-${Date.now().toString(36)}-${requestCounter.toString(36)}`
}

function assertBoundedJson(value) {
  let nodes = 0
  const ancestors = new WeakSet()
  function visit(candidate, depth) {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new TypeError('Peer payload is too complex')
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'string') return
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('Peer payload numbers must be finite')
      return
    }
    if (!candidate || typeof candidate !== 'object' || ancestors.has(candidate)) {
      throw new TypeError('Peer payload must contain acyclic JSON values')
    }
    ancestors.add(candidate)
    if (Array.isArray(candidate)) {
      if (candidate.length > 4096) throw new TypeError('Peer payload array is too large')
      for (const child of candidate) visit(child, depth + 1)
    } else {
      const prototype = Object.getPrototypeOf(candidate)
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Peer payload object is invalid')
      const keys = Object.keys(candidate)
      if (keys.length > 1024) throw new TypeError('Peer payload object is too large')
      for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new TypeError('Peer payload key is invalid')
        visit(candidate[key], depth + 1)
      }
    }
    ancestors.delete(candidate)
  }
  visit(value, 0)
  if (utf8ByteLength(JSON.stringify(value)) > MAX_JSON_BYTES) throw new TypeError('Peer payload exceeds 2 MiB')
}

function notifySubscriber(listener, payload) {
  try {
    listener(payload)
  } catch (error) {
    console.error('[fulltime peers] renderer subscriber failed', error)
  }
}

ipcRenderer.on(EVENT_CHANNEL, (_event, payload) => {
  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return
  if (subscribers.size === 0) {
    backlog.push(payload)
    if (backlog.length > MAX_BACKLOG) backlog.shift()
    return
  }
  for (const listener of [...subscribers]) notifySubscriber(listener, payload)
})

contextBridge.exposeInMainWorld('fullTimePeers', {
  async resetIdentity() {
    const response = await ipcRenderer.invoke('fulltime-peers:reset-identity')
    if (!response || response.ok !== true) throw new Error(response?.error?.message || 'FullTime could not reset this device identity')
  },
  async getConfig() {
    const response = await ipcRenderer.invoke('fulltime-peers:get-config')
    if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
      throw new Error('The desktop host returned an invalid configuration response')
    }
    if (response.ok) {
      assertBoundedJson(response.result)
      return response.result
    }
    if (!response.error || typeof response.error !== 'object' ||
        typeof response.error.code !== 'string' || typeof response.error.message !== 'string' ||
        !response.error.code || !response.error.message) {
      throw new Error('The desktop host returned an invalid configuration error')
    }
    const error = new Error(response.error.message)
    error.code = response.error.code
    throw error
  },
  async request(action, payload) {
    if (typeof action !== 'string' || !ROOM_ACTIONS.has(action)) throw new TypeError('Unknown room action')
    assertBoundedJson(payload)
    const id = nextRequestId()
    const response = await ipcRenderer.invoke('fulltime-peers:request', {
      version: 2,
      id,
      action,
      payload
    })
    if (!response || response.version !== 2 || response.id !== id || typeof response.ok !== 'boolean') {
      throw new Error('The room worker returned an invalid response')
    }
    if (!response.ok) {
      const error = new Error(response.error?.message || 'Room request failed')
      error.code = response.error?.code || 'ROOM_REQUEST_FAILED'
      throw error
    }
    assertBoundedJson(response.result)
    return response.result
  },
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscribe requires a listener')
    subscribers.add(listener)
    if (subscribers.size === 1 && backlog.length > 0) {
      const queued = backlog.splice(0)
      for (const event of queued) notifySubscriber(listener, event)
    }
    return () => subscribers.delete(listener)
  }
})
