'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const b4a = require('b4a')
const Corestore = require('corestore')
const createTestnet = require('hyperdht/testnet')
const crypto = require('hypercore-crypto')
const Hyperswarm = require('hyperswarm')

const {
  EncryptedMediaStore,
  MEDIA_PLAINTEXT_CHUNK_BYTES
} = require('../lib/encrypted-media.js')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1'

test('encrypted Hyperblobs replicate by pinned core key across a local HyperDHT swarm', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1 to bind a local DHT testnet',
  timeout: 90_000
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-media-dht-'))
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const authorStore = new Corestore(path.join(root, 'author'))
  const readerStore = new Corestore(path.join(root, 'reader'))
  const authorSwarm = new Hyperswarm({ bootstrap: testnet.bootstrap })
  const readerSwarm = new Hyperswarm({ bootstrap: testnet.bootstrap })
  authorSwarm.on('connection', (connection) => authorStore.replicate(connection))
  readerSwarm.on('connection', (connection) => readerStore.replicate(connection))

  const epochKey = crypto.randomBytes(32)
  const author = new EncryptedMediaStore({
    store: authorStore,
    roomId: 'room_dht_media',
    authorId: 'peer_dht_author',
    epoch: 1,
    epochKey
  })
  const reader = new EncryptedMediaStore({
    store: readerStore,
    roomId: 'room_dht_media',
    authorId: 'peer_dht_reader',
    epoch: 1,
    epochKey,
    readTimeoutMs: 30_000
  })

  try {
    const plaintext = b4a.alloc(MEDIA_PLAINTEXT_CHUNK_BYTES * 2 + 701, 0x5a)
    b4a.from('%PDF-1.7\n').copy(plaintext, 0)
    const descriptor = await author.put({ name: 'verified-match-report.pdf', source: plaintext })

    const topic = crypto.hash(b4a.from('fulltime/encrypted-media/local-dht-test/v1'))
    const authorDiscovery = authorSwarm.join(topic, { server: true, client: false })
    await authorDiscovery.flushed()
    readerSwarm.join(topic, { server: false, client: true })
    await readerSwarm.flush()
    await waitFor(() => authorSwarm.connections.size > 0 && readerSwarm.connections.size > 0, 'media swarm connection')

    assert.deepEqual(await reader.get(descriptor), plaintext)
    assert.equal(reader.remoteSessions.size, 0, 'remote core session must be released after verification')
  } finally {
    await Promise.allSettled([author.close(), reader.close()])
    await Promise.allSettled([authorSwarm.destroy(), readerSwarm.destroy()])
    await Promise.allSettled([authorStore.close(), readerStore.close()])
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function waitFor (predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
