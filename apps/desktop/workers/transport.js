'use strict'

const b4a = require('b4a')
const FramedStream = require('framed-stream')
const goodbye = require('graceful-goodbye')
const Hyperswarm = require('hyperswarm')

const { normalizeDisplayName, parseWorkerOptions } = require('../lib/config.js')
const { PeerFrameDecoder, encodePeerFrame } = require('../lib/peer-frame.js')
const {
  MAX_IPC_FRAME_BYTES,
  MAX_PEER_FRAME_BYTES,
  PEER_PROTOCOL,
  PROTOCOL_VERSION,
  ProtocolError,
  encodeJsonFrame,
  parseJsonFrame,
  validatePeerEnvelope,
  validateWorkerCommand
} = require('../lib/protocol.js')

const options = parseWorkerOptions(Bare.argv.slice(2))
const topic = b4a.from(options.topicHex, 'hex')
const pipe = new FramedStream(Bare.IPC, { bits: 16 })
const swarm = new Hyperswarm(options.bootstrap ? { bootstrap: options.bootstrap } : {})
const peers = new Map()
const seenMessages = new Set()
const seenOrder = []
const MAX_SEEN_MESSAGES = 2048
const MAX_PEER_CONNECTIONS = 32
const MAX_PEER_FRAMES_PER_WINDOW = 120
const PEER_RATE_WINDOW_MS = 10_000
const HELLO_TIMEOUT_MS = 5_000
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60_000

let discovery = null
let closing = false
const localPeerId = b4a.toString(swarm.keyPair.publicKey, 'hex')

function writeIpc(frame) {
  if (closing && frame.type !== 'transport.response') return
  pipe.write(b4a.from(encodeJsonFrame(frame, MAX_IPC_FRAME_BYTES), 'utf8'))
}

function writePeer(state, frame) {
  if (state.writeBlocked) {
    throw new ProtocolError('PEER_BACKPRESSURE', 'Peer output did not drain before the next message')
  }
  const body = b4a.from(encodeJsonFrame(frame, MAX_PEER_FRAME_BYTES), 'utf8')
  if (!state.connection.write(encodePeerFrame(body, MAX_PEER_FRAME_BYTES))) {
    state.writeBlocked = true
    state.connection.once('drain', () => {
      state.writeBlocked = false
    })
  }
}

function peerCount() {
  let count = 0
  for (const state of peers.values()) if (state.ready) count += 1
  return count
}

function emitPeers() {
  writeIpc({ version: PROTOCOL_VERSION, type: 'transport.peers', count: peerCount(), at: Date.now() })
}

function emitError(code, message, recoverable = true) {
  writeIpc({ version: PROTOCOL_VERSION, type: 'transport.error', code, message, recoverable })
}

function rememberMessage(peerId, messageId) {
  const key = `${peerId}:${messageId}`
  if (seenMessages.has(key)) return false
  seenMessages.add(key)
  seenOrder.push(key)
  if (seenOrder.length > MAX_SEEN_MESSAGES) seenMessages.delete(seenOrder.shift())
  return true
}

function consumePeerFrame(state) {
  const now = Date.now()
  if (now - state.rateWindowStartedAt >= PEER_RATE_WINDOW_MS) {
    state.rateWindowStartedAt = now
    state.framesInWindow = 0
  }
  state.framesInWindow += 1
  if (state.framesInWindow > MAX_PEER_FRAMES_PER_WINDOW) {
    throw new ProtocolError('PEER_RATE_LIMIT', 'Peer sent too many frames')
  }
}

function helloFrame() {
  return {
    version: PROTOCOL_VERSION,
    protocol: PEER_PROTOCOL,
    type: 'transport.hello',
    roomCode: options.roomCode,
    displayName: options.displayName
  }
}

function onPeerEnvelope(state, frame) {
  if (frame.type === 'transport.hello') {
    if (state.ready) return
    const displayName = normalizeDisplayName(frame.displayName)
    clearTimeout(state.helloTimer)
    state.ready = true
    state.displayName = displayName
    writeIpc({
      version: PROTOCOL_VERSION,
      type: 'transport.peer-joined',
      peerId: state.peerId,
      displayName: state.displayName,
      peerCount: peerCount(),
      at: Date.now()
    })
    emitPeers()
    return
  }

  if (!state.ready) throw new ProtocolError('HANDSHAKE_REQUIRED', 'Peer sent a message before its handshake')
  if (frame.sentAt > Date.now() + MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new ProtocolError('CLOCK_SKEW', 'Peer message timestamp is too far in the future')
  }
  if (!rememberMessage(state.peerId, frame.messageId)) return
  writeIpc({
    version: PROTOCOL_VERSION,
    type: 'transport.message',
    messageId: frame.messageId,
    from: { peerId: state.peerId, displayName: state.displayName, isSelf: false },
    payload: frame.payload,
    sentAt: frame.sentAt,
    receivedAt: Date.now()
  })
}

function onConnection(connection) {
  if (peers.size >= MAX_PEER_CONNECTIONS) {
    emitError('PEER_LIMIT', 'The development room reached its peer connection limit.', true)
    connection.destroy()
    return
  }
  const peerId = b4a.toString(connection.remotePublicKey, 'hex')
  const state = {
    connection,
    decoder: new PeerFrameDecoder(MAX_PEER_FRAME_BYTES),
    peerId,
    displayName: 'Peer',
    ready: false,
    framesInWindow: 0,
    rateWindowStartedAt: Date.now(),
    writeBlocked: false,
    helloTimer: null
  }
  state.helloTimer = setTimeout(() => {
    if (!state.ready) connection.destroy(new Error('Peer handshake timed out'))
  }, HELLO_TIMEOUT_MS)
  if (typeof state.helloTimer.unref === 'function') state.helloTimer.unref()
  peers.set(connection, state)

  connection.on('data', (chunk) => {
    try {
      for (const body of state.decoder.push(chunk)) {
        consumePeerFrame(state)
        const frame = validatePeerEnvelope(
          parseJsonFrame(b4a.toString(body, 'utf8'), MAX_PEER_FRAME_BYTES),
          options.roomCode
        )
        onPeerEnvelope(state, frame)
      }
    } catch (error) {
      emitError('PEER_PROTOCOL', 'A peer sent an invalid or oversized frame.', true)
      connection.destroy(error)
    }
  })
  connection.on('error', () => {})
  connection.once('close', () => {
    clearTimeout(state.helloTimer)
    peers.delete(connection)
    if (!state.ready || closing) return
    writeIpc({
      version: PROTOCOL_VERSION,
      type: 'transport.peer-left',
      peerId: state.peerId,
      displayName: state.displayName,
      peerCount: peerCount(),
      at: Date.now()
    })
    emitPeers()
  })

  try {
    writePeer(state, helloFrame())
  } catch (error) {
    connection.destroy(error)
  }
}

function respond(requestId, response) {
  writeIpc({ version: PROTOCOL_VERSION, type: 'transport.response', requestId, ...response })
}

async function shutdown() {
  if (closing) return
  closing = true
  for (const { connection } of peers.values()) connection.destroy()
  peers.clear()
  if (discovery && typeof discovery.destroy === 'function') {
    await Promise.resolve(discovery.destroy()).catch(() => {})
  }
  await Promise.resolve(swarm.destroy()).catch(() => {})
}

async function onWorkerCommand(data) {
  let frame
  try {
    frame = parseJsonFrame(b4a.toString(data, 'utf8'), MAX_IPC_FRAME_BYTES)
    validateWorkerCommand(frame)
    if (frame.type === 'transport.close') {
      respond(frame.requestId, { ok: true })
      await shutdown()
      return
    }

    rememberMessage(localPeerId, frame.messageId)
    const peerFrame = {
      version: PROTOCOL_VERSION,
      protocol: PEER_PROTOCOL,
      type: 'transport.message',
      roomCode: options.roomCode,
      messageId: frame.messageId,
      payload: frame.payload,
      sentAt: frame.sentAt
    }
    let queuedTo = 0
    for (const state of peers.values()) {
      if (!state.ready) continue
      try {
        writePeer(state, peerFrame)
        queuedTo += 1
      } catch (error) {
        state.connection.destroy(error)
      }
    }
    writeIpc({
      version: PROTOCOL_VERSION,
      type: 'transport.message',
      messageId: frame.messageId,
      from: { peerId: localPeerId, displayName: options.displayName, isSelf: true },
      payload: frame.payload,
      sentAt: frame.sentAt,
      receivedAt: Date.now()
    })
    respond(frame.requestId, { ok: true, messageId: frame.messageId, queuedTo })
  } catch (error) {
    const requestId = frame && frame.requestId
    const code = error instanceof ProtocolError ? error.code : 'COMMAND_FAILED'
    const message = error instanceof ProtocolError ? error.message : 'Worker command failed'
    if (requestId) respond(requestId, { ok: false, errorCode: code, errorMessage: message })
    else emitError('COMMAND_PROTOCOL', 'The local shell sent an invalid command.', true)
  }
}

async function main() {
  pipe.on('data', (data) => void onWorkerCommand(data))
  pipe.once('close', () => void shutdown())
  swarm.on('connection', onConnection)
  swarm.on('error', () => emitError('SWARM_NETWORK', 'Hyperswarm reported a network error.', true))

  discovery = swarm.join(topic, { client: true, server: true })
  await discovery.flushed()
  writeIpc({
    version: PROTOCOL_VERSION,
    type: 'transport.ready',
    mode: 'development-transport-smoke',
    roomCode: options.roomCode,
    displayName: options.displayName,
    peerId: localPeerId,
    peerCount: 0
  })
  emitPeers()
}

goodbye(() => shutdown())

main().catch((error) => {
  emitError('WORKER_STARTUP', 'The ephemeral peer transport could not start.', false)
  console.error(error)
  void shutdown().finally(() => Bare.exit(1))
})
