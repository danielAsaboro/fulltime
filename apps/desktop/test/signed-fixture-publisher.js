'use strict'

const b4a = require('b4a')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')

const { parseFixturePlaneRecord } = require('../lib/fixture-plane-record.js')

const CORE_NAME = 'fulltime-public-fixture-plane-v1'

class SignedFixturePublisher {
  constructor ({ storagePath, bootstrap }) {
    this.storagePath = storagePath
    this.bootstrap = bootstrap
    this.store = null
    this.core = null
    this.swarm = null
    this.discovery = null
  }

  get key () {
    if (!this.core) throw new Error('Signed fixture publisher is not open')
    return b4a.toString(this.core.key, 'hex')
  }

  async open () {
    this.store = new Corestore(this.storagePath)
    await this.store.ready()
    this.core = this.store.get({ name: CORE_NAME, active: true })
    await this.core.ready()
    this.swarm = new Hyperswarm({ bootstrap: this.bootstrap })
    this.swarm.on('connection', (connection) => this.store.replicate(connection))
    this.discovery = this.swarm.join(this.core.discoveryKey, { server: true, client: true })
    await this.discovery.flushed()
    return this
  }

  async publish (record) {
    if (!this.core) throw new Error('Signed fixture publisher is not open')
    const validated = parseFixturePlaneRecord(record)
    await this.core.append(b4a.from(JSON.stringify(validated)))
    return validated
  }

  publishFixture (fixture, publishedAt = Date.now()) {
    return this.publish({ version: 1, kind: 'fixture.upsert', publishedAt, fixture })
  }

  publishScore ({ update, state, events = [], publishedAt = Date.now() }) {
    return this.publish({ version: 1, kind: 'fixture.score', publishedAt, update, state, events })
  }

  async close () {
    await this.discovery?.destroy().catch(() => {})
    await this.swarm?.destroy().catch(() => {})
    await this.store?.close().catch(() => {})
    this.discovery = null
    this.swarm = null
    this.core = null
    this.store = null
  }
}

module.exports = { SignedFixturePublisher }
