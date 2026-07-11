'use strict'

const b4a = require('b4a')
const FramedStream = require('framed-stream')
const goodbye = require('graceful-goodbye')

const { parseRoomWorkerOptions } = require('../lib/config.js')
const {
  ROOM_IPC_VERSION,
  encodeRoomFrame,
  errorResponse,
  parseRoomFrame,
  validateEvent,
  validateRequest
} = require('../lib/room-protocol.js')
const { decodeWorkerBootstrap } = require('../lib/worker-bootstrap.js')
const { RoomManager } = require('./room-manager.js')

const MAX_ACTIVE_REQUESTS = 128
const MAX_QUEUED_BEFORE_BOOTSTRAP = 8
const FAILED_STARTUP_CLEANUP_MS = 2_000
// PearRuntime prefixes executable and entry names while Bare Kit exposes the
// supplied worklet arguments directly. Anchor at the first required flag so
// this exact peer core runs under both hosts without platform-specific forks.
const firstOption = Bare.argv.indexOf('--storage')
const options = parseRoomWorkerOptions(firstOption === -1 ? [] : Bare.argv.slice(firstOption))
const pipe = new FramedStream(Bare.IPC, { bits: 24 })

let activeRequests = 0
let closing = false
let manager = null
let stage = 'awaiting-bootstrap'
const queuedFrames = []

function write (frame) {
  if (closing && frame.type !== undefined) return
  pipe.write(b4a.from(encodeRoomFrame(frame), 'utf8'))
}

function emitEvent (event) {
  try {
    write(validateEvent(event))
  } catch (error) {
    console.error('[fulltime rooms] invalid local event', error)
  }
}

async function onRequest (data) {
  let frame
  try {
    frame = validateRequest(parseRoomFrame(data))
    if (activeRequests >= MAX_ACTIVE_REQUESTS) {
      const error = new Error('Too many room requests are active')
      error.code = 'TOO_MANY_REQUESTS'
      write(errorResponse(frame.id, error))
      return
    }
    if (frame.action === 'system.close') {
      await shutdown()
      write({ version: ROOM_IPC_VERSION, id: frame.id, ok: true, result: null })
      return
    }
    activeRequests++
    try {
      const result = await manager.dispatch(frame.action, frame.payload)
      write({ version: ROOM_IPC_VERSION, id: frame.id, ok: true, result: result === undefined ? null : result })
    } finally {
      activeRequests--
    }
  } catch (error) {
    if (frame?.id) write(errorResponse(frame.id, error))
    else emitEvent({
      version: ROOM_IPC_VERSION,
      type: 'room.error',
      code: 'COMMAND_PROTOCOL',
      message: 'The desktop host sent an invalid room request.',
      recoverable: true,
      at: Date.now()
    })
  }
}

async function shutdown () {
  if (closing) return
  closing = true
  await manager?.close().catch((error) => console.error('[fulltime rooms] shutdown failed', error))
}

async function bootstrap (data) {
  let bootstrap = null
  try {
    bootstrap = decodeWorkerBootstrap(data)
    manager = new RoomManager({ ...options, deviceSecret: bootstrap.deviceSecret })
    bootstrap.deviceSecret.fill(0)
    bootstrap = null
    manager.on('event', emitEvent)
    await manager.open()
    stage = 'ready'
    while (queuedFrames.length) await onRequest(queuedFrames.shift())
  } catch (error) {
    bootstrap?.deviceSecret.fill(0)
    emitEvent({
      version: ROOM_IPC_VERSION,
      type: 'room.error',
      code: 'WORKER_STARTUP',
      message: 'The encrypted peer room worker could not start.',
      recoverable: false,
      at: Date.now()
    })
    console.error(error)
    // A partially opened Corestore can itself hang while closing (for example
    // after a storage lock failure). Do not leave the IPC process alive in
    // that state: the desktop controller must observe worker exit and reject
    // requests immediately instead of timing every command out.
    await Promise.race([
      shutdown(),
      new Promise((resolve) => setTimeout(resolve, FAILED_STARTUP_CLEANUP_MS))
    ])
    Bare.exit(1)
  }
}

function onData (data) {
  if (stage === 'awaiting-bootstrap') {
    stage = 'opening'
    void bootstrap(data)
    return
  }
  if (stage === 'opening') {
    if (queuedFrames.length >= MAX_QUEUED_BEFORE_BOOTSTRAP) {
      emitEvent({
        version: ROOM_IPC_VERSION,
        type: 'room.error',
        code: 'WORKER_STARTUP',
        message: 'The encrypted peer room worker is still starting.',
        recoverable: true,
        at: Date.now()
      })
      return
    }
    queuedFrames.push(b4a.from(data))
    return
  }
  if (stage === 'ready') void onRequest(data)
}

function main () {
  pipe.on('data', onData)
  pipe.once('close', () => void shutdown())
}

goodbye(() => shutdown())

main()
