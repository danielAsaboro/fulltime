'use strict'

const ROOM_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/
const MAX_NAME_LENGTH = 48
const MAX_STORAGE_LENGTH = 1024
const FIXTURE_FEED_KEY_PATTERN = /^[a-f0-9]{64}$/
const UNSAFE_DISPLAY_NAME_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

function normalizeRoomCode(value) {
  if (typeof value !== 'string') throw new TypeError('Room code must be a string')
  const roomCode = value.trim().toLowerCase()
  if (!ROOM_CODE_PATTERN.test(roomCode)) {
    throw new TypeError('Room code must be 3-64 letters, numbers, underscores, or hyphens')
  }
  return roomCode
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string') throw new TypeError('Display name must be a string')
  const displayName = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!displayName || displayName.length > MAX_NAME_LENGTH || UNSAFE_DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new TypeError(`Display name must be 1-${MAX_NAME_LENGTH} printable characters`)
  }
  return displayName
}

function normalizeStoragePath(value) {
  if (typeof value !== 'string') throw new TypeError('Storage path must be a string')
  const storagePath = value.trim()
  if (!storagePath || storagePath.length > MAX_STORAGE_LENGTH || storagePath.includes('\u0000')) {
    throw new TypeError('Storage path is invalid')
  }
  return storagePath
}

function normalizeFixtureFeedKey(value) {
  if (typeof value !== 'string' || !FIXTURE_FEED_KEY_PATTERN.test(value)) {
    throw new TypeError('Fixture feed key must be 32-byte lowercase hex')
  }
  return value
}

function parseBootstrap(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('--bootstrap requires JSON')
  let bootstrap
  try {
    bootstrap = JSON.parse(value)
  } catch {
    throw new TypeError('--bootstrap must be valid JSON')
  }
  if (!Array.isArray(bootstrap) || bootstrap.length < 1 || bootstrap.length > 16) {
    throw new TypeError('--bootstrap must contain 1-16 DHT addresses')
  }
  return bootstrap.map((address) => {
    if (!address || typeof address !== 'object' || Array.isArray(address)) {
      throw new TypeError('Each bootstrap address must contain host and port')
    }
    const host = address.host
    const port = address.port
    if (
      typeof host !== 'string' ||
      !host ||
      host.length > 255 ||
      /[\u0000-\u0020\u007f]/.test(host) ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new TypeError('Each bootstrap address must contain a valid host and port')
    }
    return { host, port }
  })
}

function readFlag(args, flag) {
  let found
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === flag) {
      if (found !== undefined) throw new TypeError(`${flag} may only be provided once`)
      const next = args[index + 1]
      if (!next || next.startsWith('--')) throw new TypeError(`${flag} requires a value`)
      found = next
      index += 1
    } else if (argument.startsWith(`${flag}=`)) {
      if (found !== undefined) throw new TypeError(`${flag} may only be provided once`)
      found = argument.slice(flag.length + 1)
      if (!found) throw new TypeError(`${flag} requires a value`)
    }
  }
  return found
}

function readSwitch(args, flag) {
  let found = false
  for (const argument of args) {
    if (argument === flag) {
      if (found) throw new TypeError(`${flag} may only be provided once`)
      found = true
    } else if (argument.startsWith(`${flag}=`)) {
      throw new TypeError(`${flag} does not accept a value`)
    }
  }
  return found
}

function parseLaunchOptions(args, defaults) {
  if (!Array.isArray(args)) throw new TypeError('Arguments must be an array')
  const storage = readFlag(args, '--storage') ?? defaults.storagePath
  const room = readFlag(args, '--room') ?? defaults.roomCode
  const name = readFlag(args, '--name') ?? defaults.displayName

  return {
    storagePath: normalizeStoragePath(storage),
    roomCode: normalizeRoomCode(room),
    displayName: normalizeDisplayName(name)
  }
}

function parseWorkerOptions(args) {
  const storagePath = readFlag(args, '--storage')
  const roomCode = readFlag(args, '--room')
  const displayName = readFlag(args, '--name')
  const topicHex = readFlag(args, '--topic')
  const bootstrapJson = readFlag(args, '--bootstrap')

  if (!storagePath || !roomCode || !displayName || !/^[a-f0-9]{64}$/.test(topicHex || '')) {
    throw new TypeError('Worker requires valid --storage, --room, --name, and --topic values')
  }

  const options = {
    storagePath: normalizeStoragePath(storagePath),
    roomCode: normalizeRoomCode(roomCode),
    displayName: normalizeDisplayName(displayName),
    topicHex
  }
  if (bootstrapJson !== undefined) options.bootstrap = parseBootstrap(bootstrapJson)
  return options
}

function parseRoomWorkerOptions(args) {
  const storagePath = readFlag(args, '--storage')
  const displayName = readFlag(args, '--name')
  const fixtureFeedKey = readFlag(args, '--fixture-feed-key')
  const answerAttestorPublicKey = readFlag(args, '--answer-attestor-public-key')
  const answerReceiptFeedKey = readFlag(args, '--answer-receipt-feed-key')
  const bootstrapJson = readFlag(args, '--bootstrap')
  const notificationsDisabled = readSwitch(args, '--disable-notifications')
  if (!storagePath || !displayName || !fixtureFeedKey) {
    throw new TypeError('Room worker requires valid --storage, --name, and --fixture-feed-key values')
  }
  const options = {
    storagePath: normalizeStoragePath(storagePath),
    displayName: normalizeDisplayName(displayName),
    fixtureFeedKey: normalizeFixtureFeedKey(fixtureFeedKey)
  }
  if ((answerAttestorPublicKey === undefined) !== (answerReceiptFeedKey === undefined)) {
    throw new TypeError('Answer attestor requires both --answer-attestor-public-key and --answer-receipt-feed-key')
  }
  if (answerAttestorPublicKey !== undefined && answerReceiptFeedKey !== undefined) {
    options.answerAttestor = {
      servicePublicKey: normalizeFixtureFeedKey(answerAttestorPublicKey),
      receiptFeedKey: normalizeFixtureFeedKey(answerReceiptFeedKey)
    }
  }
  if (bootstrapJson !== undefined) options.bootstrap = parseBootstrap(bootstrapJson)
  if (notificationsDisabled) options.notificationsEnabled = false
  return options
}

module.exports = {
  MAX_NAME_LENGTH,
  normalizeFixtureFeedKey,
  normalizeDisplayName,
  normalizeRoomCode,
  normalizeStoragePath,
  parseBootstrap,
  parseLaunchOptions,
  parseRoomWorkerOptions,
  parseWorkerOptions
}
