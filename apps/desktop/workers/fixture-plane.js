'use strict'

const EventEmitter = require('bare-events')
const b4a = require('b4a')
const Hypercore = require('hypercore')
const tcp = require('#fulltime-tcp')

const { decodeFixturePlaneRecord } = require('../lib/fixture-plane-record.js')
const {
  MAX_FIXTURE_PROOF_BYTES,
  decodeFixtureProof,
  encodeFixtureProofRequest
} = require('../lib/fixture-proof-stream.js')
const { projectMarketSays, projectPressure } = require('../lib/match-intelligence.js')

const FEED_KEY_PATTERN = /^[a-f0-9]{64}$/
const SNAPSHOT_SYNC_TIMEOUT_MS = 60_000

class FixtureProjection {
  constructor () {
    this.fixtures = new Map()
    this.scores = new Map()
    this.odds = new Map()
    this.oddsByFixture = new Map()
    this.eventsByFixture = new Map()
    this.calls = new Map()
    this.settlements = new Map()
    this.verifiedSnapshots = new Map()
  }

  apply (record, metadata = {}) {
    let fixtureId
    if (record.kind === 'fixture.upsert') {
      fixtureId = String(record.fixture.id)
      this.fixtures.set(fixtureId, record.fixture)
      this._rememberSnapshot(record.fixture)
    } else if (record.kind === 'fixture.score') {
      fixtureId = String(record.update.fixtureId)
      const current = this.scores.get(fixtureId)
      if (current && record.update.seq <= current.update.seq) return null
      this.scores.set(fixtureId, record)
      let events = this.eventsByFixture.get(fixtureId)
      if (!events) {
        events = new Map()
        this.eventsByFixture.set(fixtureId, events)
      }
      for (const event of record.events) {
        const existing = events.get(event.id)
        if (existing && canonicalJson(existing) !== canonicalJson(event)) {
          throw new Error(`Fixture feed contains conflicting event ${event.id}`)
        }
        events.set(event.id, event)
      }
    } else if (record.kind === 'fixture.odds') {
      fixtureId = String(record.odds.fixtureId)
      const current = this.odds.get(fixtureId)
      let history = this.oddsByFixture.get(fixtureId)
      if (!history) {
        history = new Map()
        this.oddsByFixture.set(fixtureId, history)
      }
      const existing = history.get(record.odds.messageId)
      if (existing && canonicalJson(existing) !== canonicalJson(record.odds)) {
        throw new Error(`Fixture feed contains conflicting odds ${record.odds.messageId}`)
      }
      history.set(record.odds.messageId, record.odds)
      if (!current || record.odds.feedTs > current.feedTs ||
          (record.odds.feedTs === current.feedTs && record.odds.messageId > current.messageId)) {
        this.odds.set(fixtureId, record.odds)
      }
    } else if (record.kind === 'call.open') {
      fixtureId = String(record.call.fixtureId)
      const existing = this.calls.get(record.call.id)
      if (existing && canonicalJson(existing.record) !== canonicalJson(record)) {
        throw new Error(`Fixture feed contains conflicting call ${record.call.id}`)
      }
      if (!existing) this.calls.set(record.call.id, { record, index: indexOrNull(metadata.index) })
    } else if (record.kind === 'call.settled') {
      fixtureId = String(record.fixtureId)
      const callEntry = this.calls.get(record.settlement.callId)
      if (!callEntry || callEntry.record.call.fixtureId !== fixtureId) {
        throw new Error(`Fixture feed settles unknown call ${record.settlement.callId}`)
      }
      if (record.settlement.outcome.status === 'settled' &&
          !callEntry.record.call.options.some((option) => option.id === record.settlement.outcome.winningOption)) {
        throw new Error(`Fixture feed settlement has an option outside call ${record.settlement.callId}`)
      }
      const existing = this.settlements.get(record.settlement.callId)
      if (existing && canonicalJson(existing.record) !== canonicalJson(record)) {
        throw new Error(`Fixture feed contains conflicting settlement ${record.settlement.callId}`)
      }
      if (!existing) this.settlements.set(record.settlement.callId, { record, index: indexOrNull(metadata.index) })
    } else {
      throw new TypeError('Fixture-plane record kind is unsupported')
    }
    const card = this.get(fixtureId)
    if (card) this._rememberSnapshot(card.fixture)
    return card
  }

  events (fixtureId) {
    const events = this.eventsByFixture.get(String(fixtureId))
    return events
      ? [...events.values()].sort((left, right) => left.feedTs - right.feedTs || String(left.id).localeCompare(String(right.id)))
      : []
  }

  oddsHistory (fixtureId) {
    const history = this.oddsByFixture.get(String(fixtureId))
    return history
      ? [...history.values()].sort((left, right) => left.feedTs - right.feedTs || String(left.messageId).localeCompare(String(right.messageId)))
      : []
  }

  listCalls (fixtureId) {
    const id = String(fixtureId)
    return [...this.calls.values()]
      .filter((entry) => entry.record.call.fixtureId === id)
      .map((entry) => {
        const settled = this.settlements.get(entry.record.call.id)
        return {
          call: entry.record.call,
          callFeedIndex: entry.index,
          settlement: settled?.record.settlement || null,
          settlementFeedIndex: settled?.index ?? null
        }
      })
      .sort((left, right) => left.call.openedAt - right.call.openedAt || String(left.call.id).localeCompare(String(right.call.id)))
  }

  getCall (callId) {
    const entry = this.calls.get(String(callId))
    if (!entry) return null
    const settled = this.settlements.get(String(callId))
    return {
      call: entry.record.call,
      callRecord: entry.record,
      callFeedIndex: entry.index,
      settlement: settled?.record.settlement || null,
      settlementRecord: settled?.record || null,
      settlementFeedIndex: settled?.index ?? null
    }
  }

  frontierFeedTs (fixtureId) {
    const id = String(fixtureId)
    const candidates = []
    const score = this.scores.get(id)
    if (score?.state?.lastFeedTs !== null && score?.state?.lastFeedTs !== undefined) {
      candidates.push(score.state.lastFeedTs)
    }
    const odds = this.odds.get(id)
    if (odds?.feedTs !== null && odds?.feedTs !== undefined) candidates.push(odds.feedTs)
    const events = this.eventsByFixture.get(id)
    if (events) {
      for (const event of events.values()) candidates.push(event.feedTs)
    }
    if (!candidates.length) return null
    return candidates.reduce((latest, candidate) => candidate > latest ? candidate : latest)
  }

  get (fixtureId) {
    const base = this.fixtures.get(String(fixtureId))
    if (!base) return null
    const scoreRecord = this.scores.get(String(fixtureId))
    const state = scoreRecord?.state || null
    const fixture = state
      ? {
          ...base,
          status: state.status,
          minute: state.minute,
          score: state.score
        }
      : { ...base }
    const status = state?.status || fixture.status
    const score = state?.score || fixture.score || null
    return {
      fixture,
      phase: phaseOf(status),
      status,
      // Room IPC rejects shared object identities even when JSON.stringify
      // would silently duplicate them. Keep the summary score independent
      // from fixture.score so a live/terminal fixture list remains encodable.
      score: score ? { ...score } : null,
      minute: state?.minute ?? fixture.minute ?? null
    }
  }

  list (filter = {}) {
    const phase = filter && filter.phase
    if (phase !== undefined && !['all', 'upcoming', 'live', 'finished'].includes(phase)) {
      throw new TypeError('Fixture phase filter is invalid')
    }
    return [...this.fixtures.keys()]
      .map((fixtureId) => this.get(fixtureId))
      .filter((card) => card && (!phase || phase === 'all' || card.phase === phase))
      .sort((left, right) => left.fixture.kickoff - right.fixture.kickoff || String(left.fixture.id).localeCompare(String(right.fixture.id)))
  }

  hasVerifiedSnapshot (fixture) {
    if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) return false
    const fixtureId = String(fixture.id || '')
    const snapshots = this.verifiedSnapshots.get(fixtureId)
    if (!snapshots) return false
    try {
      return snapshots.has(canonicalJson(fixture))
    } catch {
      return false
    }
  }

  _rememberSnapshot (fixture) {
    const fixtureId = String(fixture.id)
    let snapshots = this.verifiedSnapshots.get(fixtureId)
    if (!snapshots) {
      snapshots = new Set()
      this.verifiedSnapshots.set(fixtureId, snapshots)
    }
    snapshots.add(canonicalJson(fixture))
  }

}

class FixturePlane extends EventEmitter {
  constructor ({ store, swarm, publicKey, relay = undefined }) {
    super()
    if (!store || !swarm) throw new TypeError('FixturePlane requires an open Corestore and Hyperswarm')
    if (typeof publicKey !== 'string' || !FEED_KEY_PATTERN.test(publicKey)) {
      throw new TypeError('Fixture feed public key must be 32-byte lowercase hex')
    }
    this.store = store
    this.swarm = swarm
    this.relay = relay
    this.relaySocket = null
    this.relayBuffer = b4a.alloc(0)
    this.relayApply = Promise.resolve()
    this.publicKey = publicKey
    this.projection = new FixtureProjection()
    this.feed = null
    this.discovery = null
    this.reader = null
    this.readerIndex = 0
    this.initialBlockRequest = null
    this.lastSyncError = null
    this.relaySyncError = null
    this.relayStatus = this.relay ? 'connecting' : 'disabled'
    this.seenRecordIndexes = new Set()
    this.opened = false
    this.closed = false
  }

  async open () {
    if (this.opened) return
    if (this.closed) throw new Error('Fixture plane is closed')
    this.feed = this.store.get({ key: b4a.from(this.publicKey, 'hex'), active: true })
    await this.feed.ready()
    if (!b4a.equals(this.feed.key, b4a.from(this.publicKey, 'hex'))) {
      throw new Error('Corestore opened a different fixture feed key')
    }
    const cachedLength = this.feed.length
    let streamStart = cachedLength
    for (let index = 0; index < cachedLength; index++) {
      const block = await this.feed.get(index, { wait: false })
      if (block) this._applyBlock(block, index)
      else streamStart = Math.min(streamStart, index)
    }
    if (this.relay) this._openProofRelay(streamStart)
    // Consumers dial the pinned publisher but do not advertise themselves as
    // fixture-feed servers. Keeping this topic client-only prevents a shared
    // public topic connection from displacing private-room peer discovery.
    this.discovery = this.swarm.join(this.feed.discoveryKey, { server: false, client: true, limit: 64 })
    // DHT discovery can legitimately take close to a minute on a freshly
    // installed mobile peer. The authenticated local feed is already open at
    // this point, so do not hold the entire room UI behind the first network
    // lookup. Replication remains live and a failed lookup is surfaced through
    // the existing fixture-plane error boundary.
    void this.discovery.flushed().catch((error) => {
      if (!this.closed) this.emit('error', error)
    })
    this.reader = this.feed.createReadStream({ start: streamStart, live: true, wait: true })
    this.readerIndex = streamStart
    this.reader.on('data', (block) => this._applyBlock(block, this.readerIndex++))
    this.reader.on('error', (error) => this.emit('error', error))
    this.opened = true
    // A fresh sparse Hypercore has no local length yet. update() can discover
    // the publisher without requesting block zero, leaving the verified
    // fixture projection empty indefinitely. Prime the first publisher-signed
    // block explicitly; Hypercore verifies its Merkle proof against the pinned
    // feed key before returning it.
    void this._primeInitialBlock(SNAPSHOT_SYNC_TIMEOUT_MS).catch((error) => {
      if (!this.closed) {
        this.lastSyncError = error
        this.emit('error', error)
      }
    })
  }

  list (filter) {
    this._assertOpen()
    return this.projection.list(filter)
  }

  get (fixtureId) {
    this._assertOpen()
    if (typeof fixtureId !== 'string' || !fixtureId || fixtureId.length > 256) throw new TypeError('Fixture ID is invalid')
    return this.projection.get(fixtureId)
  }

  events (fixtureId) {
    this._assertOpen()
    return this.projection.events(fixtureId)
  }

  oddsHistory (fixtureId) {
    this._assertOpen()
    return this.projection.oddsHistory(fixtureId)
  }

  listCalls (fixtureId) {
    this._assertOpen()
    return this.projection.listCalls(fixtureId)
  }

  getCall (callId) {
    this._assertOpen()
    return this.projection.getCall(callId)
  }

  intelligence (fixtureId) {
    this._assertOpen()
    const card = this.get(fixtureId)
    if (!card) return null
    const events = this.events(fixtureId)
    const oddsHistory = this.oddsHistory(fixtureId)
    return {
      card,
      timeline: events,
      oddsHistory,
      marketSays: projectMarketSays(card.fixture.id, oddsHistory, events),
      pressure: projectPressure(card.fixture.id, events, oddsHistory),
      calls: this.listCalls(fixtureId),
      frontierFeedTs: this.projection.frontierFeedTs(fixtureId)
    }
  }

  frontierFeedTs (fixtureId) {
    this._assertOpen()
    return this.projection.frontierFeedTs(fixtureId)
  }

  async head () {
    this._assertOpen()
    await this.feed.update({ wait: false })
    return {
      key: this.publicKey,
      fork: this.feed.fork,
      length: this.feed.length,
      treeHash: b4a.toString(await this.feed.treeHash(), 'hex')
    }
  }

  requireFixture (fixtureId) {
    const card = this.get(fixtureId)
    if (!card) throw new Error(`Fixture ${fixtureId} is not available from the verified publisher`)
    return card.fixture
  }

  hasVerifiedSnapshot (fixture) {
    this._assertOpen()
    return this.projection.hasVerifiedSnapshot(fixture)
  }

  assertVerifiedSnapshot (fixture) {
    if (!this.hasVerifiedSnapshot(fixture)) {
      const fixtureId = String(fixture?.id || 'unknown')
      const snapshots = this.projection.verifiedSnapshots.get(fixtureId)
      const syncError = this.relaySyncError || this.lastSyncError ||
        (this.relay && this.relayStatus === 'connected'
          ? new Error('Fixture proof relay connected but did not deliver a verified block')
          : null)
      const error = snapshots?.size
        ? new Error(`Fixture ${fixtureId} is not an exact snapshot from the verified publisher`)
        : new Error(syncError
            ? `Fixture ${fixtureId} has not synchronized from the verified publisher: ${syncError.message}`
            : `Fixture ${fixtureId} has not synchronized from the verified publisher`,
          syncError ? { cause: syncError } : undefined)
      error.code = snapshots?.size ? 'FIXTURE_SNAPSHOT_UNVERIFIED' : 'FIXTURE_SNAPSHOT_UNAVAILABLE'
      throw error
    }
    return fixture
  }

  async assertVerifiedSnapshotAfterSync (fixture, timeoutMs = SNAPSHOT_SYNC_TIMEOUT_MS) {
    this._assertOpen()
    if (this.hasVerifiedSnapshot(fixture)) return fixture
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new TypeError('Fixture snapshot sync timeout is invalid')
    }

    await new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.removeListener('update', onUpdate)
        resolve()
      }
      const onUpdate = () => {
        if (this.hasVerifiedSnapshot(fixture)) finish()
      }
      const timer = setTimeout(finish, timeoutMs)
      timer.unref?.()
      this.on('update', onUpdate)
      void this._primeInitialBlock(timeoutMs).then(onUpdate, finish)
    })
    return this.assertVerifiedSnapshot(fixture)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.opened = false
    this.relaySocket?.destroy()
    await this.relayApply.catch(() => {})
    if (this.reader) this.reader.destroy()
    if (this.discovery) await this.discovery.destroy().catch(() => {})
    if (this.feed) await this.feed.close().catch(() => {})
    this.reader = null
    this.discovery = null
    this.feed = null
    this.relaySocket = null
    this.relayBuffer = b4a.alloc(0)
    this.relayApply = Promise.resolve()
    this.initialBlockRequest = null
    this.seenRecordIndexes.clear()
    this.removeAllListeners()
  }

  _applyBlock (block, index) {
    if (!Number.isSafeInteger(index) || index < 0) {
      this.emit('error', new Error('Fixture-plane reader produced an invalid feed index'))
      return
    }
    if (this.seenRecordIndexes.has(index)) return
    try {
      const record = decodeFixturePlaneRecord(block)
      const card = this.projection.apply(record, { index })
      this.seenRecordIndexes.add(index)
      if (card) this.emit('update', card)
    } catch (error) {
      this.emit('error', error)
    }
  }

  _primeInitialBlock (timeoutMs) {
    if (this.seenRecordIndexes.has(0)) return Promise.resolve()
    if (this.initialBlockRequest) return this.initialBlockRequest
    const request = this.feed.get(0, { timeout: timeoutMs }).then((block) => {
      if (block) this._applyBlock(block, 0)
    })
    this.initialBlockRequest = request.finally(() => {
      this.initialBlockRequest = null
    })
    return this.initialBlockRequest
  }

  _openProofRelay (start) {
    this.relaySocket = tcp.createConnection(this.relay.port, this.relay.host, () => {
      if (this.closed) return
      this.relayStatus = 'connected'
      this.relaySocket.write(encodeFixtureProofRequest({ length: this.feed.length, start }))
    })
    this.relaySocket.setTimeout?.(10_000, () => {
      if (this.closed || this.seenRecordIndexes.has(0)) return
      this.relaySocket.destroy(new Error('Fixture proof relay connection or first proof timed out'))
    })
    this.relaySocket.on('data', (chunk) => this._consumeProofRelay(chunk))
    this.relaySocket.on('error', (error) => {
      if (!this.closed) {
        this.relayStatus = 'failed'
        this.relaySyncError = error
        this.emit('error', error)
      }
    })
  }

  _consumeProofRelay (chunk) {
    if (this.closed) return
    this.relayBuffer = b4a.concat([this.relayBuffer, chunk])
    while (this.relayBuffer.byteLength >= 4) {
      const length = readUInt32BE(this.relayBuffer, 0)
      if (length < 2 || length > MAX_FIXTURE_PROOF_BYTES) {
        this.relaySocket.destroy(new RangeError('Fixture proof relay declared an invalid frame size'))
        return
      }
      if (this.relayBuffer.byteLength < 4 + length) return
      const payload = this.relayBuffer.subarray(4, 4 + length)
      this.relayBuffer = this.relayBuffer.subarray(4 + length)
      this.relayApply = this.relayApply.then(async () => {
        const { index, proof } = decodeFixtureProof(payload)
        if (proof.manifest) {
          const manifestKey = Hypercore.key(proof.manifest)
          const manifestKeyHex = b4a.toString(manifestKey, 'hex')
          if (manifestKeyHex !== this.publicKey) {
            throw new Error(`Fixture proof manifest resolves to ${b4a.toString(manifestKey, 'hex')} instead of the pinned feed key`)
          }
          if (!this.feed.manifest) await this.feed.core.setManifest(proof.manifest)
        }
        await this.feed.applyProof(this.feed.manifest && proof.manifest ? { ...proof, manifest: null } : proof)
        const block = await this.feed.get(index, { wait: false })
        if (!block) throw new Error(`Verified fixture proof did not persist block ${index}`)
        this._applyBlock(block, index)
        this.relayStatus = 'verified'
        if (!this.closed && !this.relaySocket.destroyed) this.relaySocket.write(b4a.from([0x06]))
      }).catch((error) => {
        if (!this.closed) {
          this.relayStatus = 'failed'
          this.relaySyncError = error
          this.emit('error', error)
        }
        this.relaySocket?.destroy()
      })
    }
    if (this.relayBuffer.byteLength > MAX_FIXTURE_PROOF_BYTES + 4) {
      this.relaySocket.destroy(new RangeError('Fixture proof relay exceeded the receive buffer limit'))
    }
  }

  _assertOpen () {
    if (!this.opened || this.closed) throw new Error('Fixture plane is not open')
  }
}

function readUInt32BE (buffer, offset) {
  return ((buffer[offset] * 0x1000000) +
    (buffer[offset + 1] << 16) +
    (buffer[offset + 2] << 8) +
    buffer[offset + 3]) >>> 0
}

function indexOrNull (value) {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Fixture feed index is invalid')
  return value
}

function phaseOf (status) {
  if (['scheduled', 'delayed', 'postponed'].includes(status)) return 'upcoming'
  if (['full-time', 'after-extra-time', 'after-penalties', 'abandoned', 'cancelled'].includes(status)) return 'finished'
  return 'live'
}

function canonicalJson (value) {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue (value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Fixture snapshot contains a non-finite number')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Fixture snapshot must contain plain JSON values')
  }
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key])
  return result
}

module.exports = {
  FEED_KEY_PATTERN,
  FixturePlane,
  FixtureProjection,
  phaseOf
}
