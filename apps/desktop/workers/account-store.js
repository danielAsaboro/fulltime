'use strict'

const b4a = require('b4a')
const Hyperbee = require('hyperbee')

const { openIdentitySeed, sealIdentitySeed } = require('../lib/account-seal.js')
const { keyAgreementKeyPairFromIdentity } = require('../lib/member-crypto.js')
const {
  createIdentity,
  keyPairFromSeed,
  normalizeDisplayName,
  ROOM_ID_PATTERN,
  userIdFromPublicKey
} = require('../lib/room-identity.js')

const ACCOUNT_SCHEMA_VERSION = 1
const PERSONAL_ITEM_ID_PATTERN = /^[a-zA-Z0-9._:-]{3,180}$/

class AccountStore {
  constructor (rootStore, initialDisplayName, { deviceSecret } = {}) {
    if (!b4a.isBuffer(deviceSecret) || deviceSecret.byteLength !== 32) {
      throw new TypeError('Account store requires a 32-byte device secret')
    }
    this.rootStore = rootStore
    this.initialDisplayName = initialDisplayName
    this.deviceSecret = b4a.from(deviceSecret)
    this.store = rootStore.namespace('fulltime-local-account-v1')
    this.db = new Hyperbee(this.store.get({ name: 'catalog' }), {
      extension: false,
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    this.identityKeyPair = null
    this.keyAgreementKeyPair = null
    this.profile = null
  }

  async ready () {
    await this.db.ready()
    let seed = null
    try {
      seed = await this._loadIdentitySeed()
      this.identityKeyPair = keyPairFromSeed(seed)
      this.keyAgreementKeyPair = keyAgreementKeyPairFromIdentity(this.identityKeyPair)
    } finally {
      seed?.fill(0)
      this.deviceSecret?.fill(0)
      this.deviceSecret = null
    }
    const userId = userIdFromPublicKey(this.identityKeyPair.publicKey)

    this.profile = await this._get('account/profile')
    if (!this.profile) {
      this.profile = {
        version: ACCOUNT_SCHEMA_VERSION,
        userId,
        displayName: normalizeDisplayName(this.initialDisplayName || 'FullTime fan'),
        signedIn: true,
        updatedAt: Date.now()
      }
      await this.db.put('account/profile', this.profile)
    } else {
      if (!isRecord(this.profile) || typeof this.profile.signedIn !== 'boolean') {
        throw new Error('The local account profile is corrupted')
      }
      const displayName = normalizeDisplayName(this.profile.displayName)
      if (this.profile.version !== ACCOUNT_SCHEMA_VERSION || this.profile.userId !== userId ||
          this.profile.displayName !== displayName) {
        this.profile = {
          ...this.profile,
          version: ACCOUNT_SCHEMA_VERSION,
          userId,
          displayName,
          updatedAt: Date.now()
        }
        await this.db.put('account/profile', this.profile)
      }
    }
    await this._migratePersonalRecords()
  }

  get userId () {
    if (!this.identityKeyPair) throw new Error('Account store is not ready')
    return userIdFromPublicKey(this.identityKeyPair.publicKey)
  }

  session () {
    if (!this.profile || !this.identityKeyPair) throw new Error('Account store is not ready')
    if (!this.profile.signedIn) return null
    return {
      userId: this.userId,
      displayName: this.profile.displayName,
      peerPublicKey: b4a.toString(this.identityKeyPair.publicKey, 'hex')
    }
  }

  requireSession () {
    const session = this.session()
    if (!session) throw new Error('Sign in to continue')
    return session
  }

  async signIn (displayName) {
    this.profile = {
      ...this.profile,
      displayName: normalizeDisplayName(displayName),
      signedIn: true,
      updatedAt: Date.now()
    }
    await this.db.put('account/profile', this.profile)
    return this.session()
  }

  async signOut () {
    this.profile = { ...this.profile, signedIn: false, updatedAt: Date.now() }
    await this.db.put('account/profile', this.profile)
  }

  async listRooms () {
    const rooms = []
    for await (const entry of this.db.createReadStream({ gte: 'room/', lt: 'room/\xff' })) {
      rooms.push(entry.value)
    }
    return rooms
  }

  getRoom (roomId) {
    validateRoomId(roomId)
    return this._get(`room/${roomId}`)
  }

  async putRoom (record) {
    if (!isRecord(record)) throw new TypeError('Room record is invalid')
    validateRoomId(record.roomId)
    await this.db.put(`room/${record.roomId}`, {
      ...record,
      version: ACCOUNT_SCHEMA_VERSION,
      updatedAt: Date.now()
    })
  }

  async getPersonal (roomId) {
    validateRoomId(roomId)
    const stored = await this._get(`personal/${roomId}`)
    return normalizePersonalRecord(stored, roomId)
  }

  async updatePersonal (roomId, patch) {
    validateRoomId(roomId)
    if (!isRecord(patch)) throw new TypeError('Personal room settings patch is invalid')
    for (const key of Object.keys(patch)) {
      if (key !== 'lastReadItemId') throw new TypeError(`Personal room setting ${key} is unsupported`)
    }
    if (patch.lastReadItemId !== undefined && patch.lastReadItemId !== null &&
        (typeof patch.lastReadItemId !== 'string' || !PERSONAL_ITEM_ID_PATTERN.test(patch.lastReadItemId))) {
      throw new TypeError('Personal room read marker is invalid')
    }
    const current = await this.getPersonal(roomId)
    const next = { ...current, ...patch, roomId, version: ACCOUNT_SCHEMA_VERSION, updatedAt: Date.now() }
    await this.db.put(`personal/${roomId}`, next)
    return next
  }

  async _migratePersonalRecords () {
    const writes = []
    for await (const entry of this.db.createReadStream({ gte: 'personal/', lt: 'personal/\xff' })) {
      const roomId = entry.key.slice('personal/'.length)
      if (!ROOM_ID_PATTERN.test(roomId)) continue
      const normalized = normalizePersonalRecord(entry.value, roomId)
      if (JSON.stringify(normalized) !== JSON.stringify(entry.value)) writes.push([entry.key, normalized])
    }
    for (const [key, value] of writes) await this.db.put(key, value)
  }

  async close () {
    this.deviceSecret?.fill(0)
    this.deviceSecret = null
    this.keyAgreementKeyPair?.secretKey.fill(0)
    this.keyAgreementKeyPair = null
    this.identityKeyPair?.secretKey.fill(0)
    this.identityKeyPair = null
    await this.db.close()
    await this.store.close()
  }

  async _get (key) {
    const entry = await this.db.get(key)
    return entry ? entry.value : null
  }

  async _loadIdentitySeed () {
    const identity = await this._get('account/identity')
    if (!identity) {
      const created = createIdentity()
      try {
        await this.db.put('account/identity', sealIdentitySeed(created.seed, this._deviceSecret()))
      } catch (error) {
        created.seed.fill(0)
        throw error
      }
      return created.seed
    }
    if (isLegacyIdentity(identity)) {
      const seed = b4a.from(identity.seed, 'hex')
      try {
        await this.db.put('account/identity', sealIdentitySeed(seed, this._deviceSecret()))
        return seed
      } catch (error) {
        seed.fill(0)
        throw error
      }
    }
    try {
      return openIdentitySeed(identity, this._deviceSecret())
    } catch (error) {
      throw new Error('The local account identity record is corrupted or cannot be opened on this device', { cause: error })
    }
  }

  _deviceSecret () {
    if (!this.deviceSecret || !b4a.isBuffer(this.deviceSecret) || this.deviceSecret.byteLength !== 32) {
      throw new Error('Account device secret is unavailable')
    }
    return this.deviceSecret
  }
}

function validateRoomId (roomId) {
  if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) throw new TypeError('Room ID is invalid')
  return roomId
}

function isRecord (value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

function isLegacyIdentity (value) {
  return isRecord(value) && Object.keys(value).length === 3 &&
    Object.hasOwn(value, 'version') && Object.hasOwn(value, 'seed') && Object.hasOwn(value, 'createdAt') &&
    value.version === ACCOUNT_SCHEMA_VERSION && typeof value.seed === 'string' && /^[a-f0-9]{64}$/.test(value.seed) &&
    Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
}

function normalizePersonalRecord (value, roomId) {
  const record = isRecord(value) ? value : {}
  const lastReadItemId = typeof record.lastReadItemId === 'string' && PERSONAL_ITEM_ID_PATTERN.test(record.lastReadItemId)
    ? record.lastReadItemId
    : null
  return {
    version: ACCOUNT_SCHEMA_VERSION,
    roomId,
    lastReadItemId,
    ...(Number.isSafeInteger(record.updatedAt) && record.updatedAt >= 0 ? { updatedAt: record.updatedAt } : {})
  }
}

module.exports = { ACCOUNT_SCHEMA_VERSION, AccountStore }
