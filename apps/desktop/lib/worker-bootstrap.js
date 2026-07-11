'use strict'

const b4a = require('b4a')

const WORKER_BOOTSTRAP_VERSION = 1
const WORKER_BOOTSTRAP_TYPE = 'fulltime.rooms.bootstrap'

function encodeWorkerBootstrap (deviceSecret) {
  if (!b4a.isBuffer(deviceSecret) || deviceSecret.byteLength !== 32) {
    throw new TypeError('Room worker device secret must be 32 bytes')
  }
  return b4a.from(JSON.stringify({
    version: WORKER_BOOTSTRAP_VERSION,
    type: WORKER_BOOTSTRAP_TYPE,
    deviceSecret: b4a.toString(deviceSecret, 'hex')
  }))
}

function decodeWorkerBootstrap (value) {
  if (!b4a.isBuffer(value) || value.byteLength < 1 || value.byteLength > 256) {
    throw new TypeError('Room worker bootstrap frame is invalid')
  }
  let frame
  try {
    frame = JSON.parse(b4a.toString(value))
  } catch {
    throw new TypeError('Room worker bootstrap frame is not valid JSON')
  }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.getPrototypeOf(frame) !== Object.prototype ||
      Object.keys(frame).length !== 3 || frame.version !== WORKER_BOOTSTRAP_VERSION ||
      frame.type !== WORKER_BOOTSTRAP_TYPE || typeof frame.deviceSecret !== 'string' ||
      !/^[a-f0-9]{64}$/.test(frame.deviceSecret)) {
    throw new TypeError('Room worker bootstrap frame is invalid')
  }
  return { deviceSecret: b4a.from(frame.deviceSecret, 'hex') }
}

module.exports = {
  WORKER_BOOTSTRAP_TYPE,
  WORKER_BOOTSTRAP_VERSION,
  decodeWorkerBootstrap,
  encodeWorkerBootstrap
}
