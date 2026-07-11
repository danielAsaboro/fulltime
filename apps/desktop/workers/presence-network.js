'use strict'

const b4a = require('b4a')
const c = require('compact-encoding')
const Protomux = require('protomux')

const { PRESENCE_PROTOCOL_NAME } = require('../lib/room-constants.js')
const {
  PRESENCE_HEARTBEAT_MS,
  PresenceSequenceTracker,
  TYPING_REFRESH_MS,
  createPresenceFrame,
  createPresenceSessionId,
  createTypingFrame,
  leaseExpiresAt
} = require('../lib/room-presence.js')
const { valueAt } = require('./room-view.js')

const CLOCK_SKEW_MS = 5 * 60_000
const MAX_DEVICE_SESSIONS_PER_USER = 4

class PresenceNetwork {
  constructor ({ account }) {
    this.account = account
    this.rooms = new Map()
    this.connections = new Map()
    this.local = new Map()
    this.remote = new Map()
    this.tracker = new PresenceSequenceTracker()
    this.closed = false
    this.heartbeat = setInterval(() => void this._heartbeat(), PRESENCE_HEARTBEAT_MS)
    this.typingHeartbeat = setInterval(() => void this._typingHeartbeat(), TYPING_REFRESH_MS)
    this.cleanup = setInterval(() => void this._expire(), 1_000)
    this.heartbeat.unref?.()
    this.typingHeartbeat.unref?.()
    this.cleanup.unref?.()
  }

  addConnection (connection, peerInfo = {}) {
    if (this.closed || this.connections.has(connection)) return
    const state = {
      connection,
      peerInfo,
      mux: Protomux.from(connection),
      channels: new Map()
    }
    this.connections.set(connection, state)
    for (const room of this.rooms.values()) this._register(state, room)
    connection.once('close', () => this.removeConnection(connection))
  }

  removeConnection (connection) {
    const state = this.connections.get(connection)
    if (!state) return
    this.connections.delete(connection)
    for (const room of this.rooms.values()) {
      state.mux.unpair(this._descriptor(room))
    }
    for (const channel of state.channels.values()) channel.close()
    state.channels.clear()
  }

  async addRoom (room) {
    if (this.closed || this.rooms.has(room.roomId)) return
    this.rooms.set(room.roomId, room)
    this.local.set(room.roomId, {
      sessionId: createPresenceSessionId(),
      sequence: 0,
      typing: false
    })
    this.remote.set(room.roomId, new Map())
    for (const state of this.connections.values()) this._register(state, room)
    await this.announce(room.roomId, 'online')
  }

  async removeRoom (roomId) {
    const room = this.rooms.get(roomId)
    if (!room) return
    await this.announce(roomId, 'offline').catch(() => {})
    this.rooms.delete(roomId)
    this.local.delete(roomId)
    this.remote.delete(roomId)
    room.presence.clear()
    for (const state of this.connections.values()) {
      state.mux.unpair(this._descriptor(room))
      const channel = state.channels.get(roomId)
      channel?.close()
      state.channels.delete(roomId)
    }
  }

  async close () {
    if (this.closed) return
    this.closed = true
    clearInterval(this.heartbeat)
    clearInterval(this.typingHeartbeat)
    clearInterval(this.cleanup)
    await Promise.allSettled([...this.rooms.keys()].map((roomId) => this.announce(roomId, 'offline')))
    for (const [connection] of this.connections) this.removeConnection(connection)
    this.rooms.clear()
    this.local.clear()
    this.remote.clear()
    this.tracker.clear()
  }

  async announce (roomId, state = 'online') {
    const room = this.rooms.get(roomId)
    const local = this.local.get(roomId)
    if (!room || !local || !room.base) return
    const member = await valueAt(room.view, `member/${this.account.userId}`)
    if (!member?.active && state !== 'offline') return
    const frame = createPresenceFrame({
      roomId,
      writerKey: room.base.local.key,
      sessionId: local.sessionId,
      sequence: local.sequence++,
      identityKeyPair: this.account.identityKeyPair,
      state
    })
    this._broadcast(roomId, frame)
  }

  async setTyping (roomId, typing) {
    const room = this.rooms.get(roomId)
    const local = this.local.get(roomId)
    if (!room || !local) throw new Error('Presence is unavailable for this room')
    const member = await valueAt(room.view, `member/${this.account.userId}`)
    if (!member?.active) throw new Error('You are not an active room member')
    const changed = local.typing !== typing
    local.typing = typing
    const frame = createTypingFrame({
      roomId,
      writerKey: room.base.local.key,
      sessionId: local.sessionId,
      sequence: local.sequence++,
      identityKeyPair: this.account.identityKeyPair,
      typing
    })
    this._broadcast(roomId, frame)
    if (changed) {
      if (typing) room.presence.set(this.account.userId, { typing: true, local: true })
      else room.presence.delete(this.account.userId)
      await room.refresh()
    }
  }

  async roomUpdated (room) {
    if (!this.rooms.has(room.roomId)) return
    const member = await valueAt(room.view, `member/${this.account.userId}`)
    if (!member?.active) await this.announce(room.roomId, 'offline')
  }

  _register (state, room) {
    if (!room.base || state.channels.has(room.roomId)) return
    const descriptor = this._descriptor(room)
    state.mux.pair(descriptor, () => this._openChannel(state, room, false))
    if (hasTopic(state.peerInfo, room.base.discoveryKey)) this._openChannel(state, room, true)
  }

  _descriptor (room) {
    return { protocol: PRESENCE_PROTOCOL_NAME, id: room.base.discoveryKey }
  }

  _openChannel (state, room, initiate) {
    if (this.closed || state.channels.has(room.roomId)) return null
    const channel = state.mux.createChannel({
      ...this._descriptor(room),
      onopen: () => void this.announce(room.roomId, 'online'),
      onclose: () => state.channels.delete(room.roomId)
    })
    if (!channel) return null
    const message = channel.addMessage({
      encoding: c.buffer,
      onmessage: (frame) => {
        void this._receive(room, frame, channel).catch(() => {})
      }
    })
    channel.presenceMessage = message
    state.channels.set(room.roomId, channel)
    if (initiate) channel.open()
    else channel.open()
    return channel
  }

  async _receive (room, encoded, source) {
    const receivedAt = Date.now()
    const frame = this.tracker.accept(encoded, { roomId: room.roomId })
    const local = this.local.get(room.roomId)
    if (frame.userId === this.account.userId && frame.sessionId === local?.sessionId) return
    if (Math.abs(frame.issuedAt - receivedAt) > CLOCK_SKEW_MS) return
    const member = await valueAt(room.view, `member/${frame.userId}`)
    if (
      !member?.active ||
      member.banned ||
      member.identityPublicKey !== frame.identityPublicKey ||
      member.writerKey !== frame.writerKey
    ) return

    const roomLeases = this.remote.get(room.roomId)
    if (!roomLeases) return
    const key = `${frame.userId}/${frame.sessionId}`
    let lease = roomLeases.get(key)
    if (!lease) {
      const deviceCount = [...roomLeases.values()].filter((entry) => entry.userId === frame.userId).length
      if (deviceCount >= MAX_DEVICE_SESSIONS_PER_USER) return
      lease = { userId: frame.userId, sessionId: frame.sessionId, presenceExpiresAt: 0, typingExpiresAt: 0, typing: false }
    }
    if (frame.type === 'presence') {
      if (frame.state === 'offline') roomLeases.delete(key)
      else {
        lease.presenceExpiresAt = leaseExpiresAt(frame, receivedAt)
        roomLeases.set(key, lease)
      }
    } else {
      if (!lease.presenceExpiresAt || lease.presenceExpiresAt <= receivedAt) return
      lease.typing = frame.typing
      lease.typingExpiresAt = frame.typing ? leaseExpiresAt(frame, receivedAt) : 0
      roomLeases.set(key, lease)
    }
    await this._projectPresence(room, receivedAt)
    this._broadcast(room.roomId, encoded, source)
  }

  _broadcast (roomId, frame, source = null) {
    for (const state of this.connections.values()) {
      const channel = state.channels.get(roomId)
      if (!channel || channel === source || channel.closed || !channel.opened) continue
      try { channel.presenceMessage.send(frame) } catch {}
    }
  }

  async _heartbeat () {
    if (this.closed) return
    for (const [roomId] of this.local) {
      await this.announce(roomId, 'online').catch(() => {})
    }
  }

  async _typingHeartbeat () {
    if (this.closed) return
    for (const [roomId, local] of this.local) {
      if (local.typing) await this.setTyping(roomId, true).catch(() => {})
    }
  }

  async _expire () {
    if (this.closed) return
    const now = Date.now()
    for (const [roomId, leases] of this.remote) {
      let changed = false
      for (const [key, lease] of leases) {
        if (lease.presenceExpiresAt <= now) {
          leases.delete(key)
          changed = true
        } else if (lease.typing && lease.typingExpiresAt <= now) {
          lease.typing = false
          lease.typingExpiresAt = 0
          changed = true
        }
      }
      if (changed) {
        const room = this.rooms.get(roomId)
        if (room) await this._projectPresence(room, now)
      }
    }
  }

  async _projectPresence (room, now) {
    const leases = this.remote.get(room.roomId)
    const next = new Map()
    if (leases) {
      for (const lease of leases.values()) {
        if (lease.presenceExpiresAt <= now) continue
        const current = next.get(lease.userId) || { typing: false }
        if (lease.typing && lease.typingExpiresAt > now) current.typing = true
        next.set(lease.userId, current)
      }
    }
    const localTyping = this.local.get(room.roomId)?.typing
    if (localTyping) next.set(this.account.userId, { typing: true, local: true })
    if (samePresence(room.presence, next)) return
    room.presence = next
    await room.refresh()
  }
}

function hasTopic (peerInfo, topic) {
  if (!peerInfo?.topics || typeof peerInfo.topics[Symbol.iterator] !== 'function') return false
  for (const candidate of peerInfo.topics) {
    if (b4a.isBuffer(candidate) && b4a.equals(candidate, topic)) return true
  }
  return false
}

function samePresence (left, right) {
  if (left.size !== right.size) return false
  for (const [userId, value] of left) {
    if (!right.has(userId) || Boolean(right.get(userId).typing) !== Boolean(value.typing)) return false
  }
  return true
}

module.exports = { MAX_DEVICE_SESSIONS_PER_USER, PresenceNetwork, hasTopic }
