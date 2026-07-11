'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const b4a = require('b4a')
const c = require('compact-encoding')
const Corestore = require('corestore')
const crypto = require('hypercore-crypto')
const FramedStream = require('framed-stream')
const createTestnet = require('hyperdht/testnet')
const Hyperswarm = require('hyperswarm')
const PearRuntime = require('pear-runtime')
const Protomux = require('protomux')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEROP === '1'

test('minimal Node server and PearRuntime client exchange bytes over one Hyperswarm topic', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEROP=1 to run the Node/Pear transport reproducer',
  timeout: 45_000
}, async () => {
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const topic = crypto.randomBytes(32)
  const server = new Hyperswarm({ bootstrap: testnet.bootstrap, maxPeers: 4 })
  const serverEvents = []
  let worker = null
  let pipe = null

  server.on('connection', (connection, peerInfo) => {
    serverEvents.push({
      type: 'connection',
      client: peerInfo.client,
      connected: connection.connected,
      remotePublicKey: b4a.toString(connection.remotePublicKey, 'hex')
    })
    connection.on('error', (error) => serverEvents.push({ type: 'connection.error', code: error.code, message: error.message }))
    connection.on('close', () => serverEvents.push({
      type: 'connection.close',
      connected: connection.connected,
      rawBytesRead: connection.rawBytesRead,
      rawBytesWritten: connection.rawBytesWritten
    }))
    connection.on('data', (data) => {
      serverEvents.push({ type: 'data', value: b4a.toString(data) })
      if (b4a.toString(data) === 'pear-ping') connection.write(b4a.from('node-pong'))
    })
  })
  server.on('error', (error) => serverEvents.push({ type: 'swarm.error', code: error.code, message: error.message }))

  try {
    const discovery = server.join(topic, { server: true, client: false })
    await discovery.flushed()
    worker = PearRuntime.run(require.resolve('./pear-hyperswarm-probe-worker.js'), [
      '--config', JSON.stringify({
        bootstrap: testnet.bootstrap,
        topic: b4a.toString(topic, 'hex')
      })
    ])
    pipe = new FramedStream(worker, { bits: 24 })
    let stderr = ''
    worker.stderr?.on('data', (data) => { stderr += data.toString() })
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pear probe IPC timed out')), 25_000)
      pipe.once('data', (data) => {
        clearTimeout(timer)
        resolve(JSON.parse(b4a.toString(data)))
      })
    })
    assert.equal(result.ok, true, JSON.stringify({
      result,
      serverPublicKey: b4a.toString(server.keyPair.publicKey, 'hex'),
      serverEvents,
      stderr,
      versions: packageVersions()
    }))
    assert.equal(result.events.some((event) => event.type === 'data' && event.value === 'node-pong'), true)
    assert.equal(serverEvents.some((event) => event.type === 'data' && event.value === 'pear-ping'), true)
  } finally {
    pipe?.destroy()
    worker?.destroy()
    await server.destroy().catch(() => {})
    await testnet.destroy().catch(() => {})
  }
})

test('Node and PearRuntime share Corestore replication and a custom Protomux channel', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEROP=1 to run the Node/Pear protocol reproducer',
  timeout: 45_000
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-pear-protomux-'))
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const store = new Corestore(path.join(root, 'server'))
  await store.ready()
  const core = store.get({ name: 'interop', active: true })
  await core.ready()
  await core.append(b4a.from('signed-core-block'))
  const protocolId = crypto.randomBytes(32)
  const server = new Hyperswarm({ bootstrap: testnet.bootstrap, maxPeers: 4 })
  const serverEvents = []
  let worker = null
  let pipe = null
  const descriptor = { protocol: 'fulltime/protomux-interop/1', id: protocolId }

  server.on('connection', (connection, peerInfo) => {
    serverEvents.push({ type: 'connection', client: peerInfo.client })
    connection.on('error', (error) => serverEvents.push({ type: 'connection.error', code: error.code, message: error.message }))
    connection.on('close', () => serverEvents.push({
      type: 'connection.close',
      rawBytesRead: connection.rawBytesRead,
      rawBytesWritten: connection.rawBytesWritten
    }))
    store.replicate(connection)
    const mux = Protomux.from(connection)
    mux.pair(descriptor, () => {
      serverEvents.push({ type: 'pair' })
      const channel = mux.createChannel({ ...descriptor, onopen: () => serverEvents.push({ type: 'channel.open' }) })
      channel.addMessage({
        encoding: c.buffer,
        onmessage: (value) => {
          serverEvents.push({ type: 'request', value: b4a.toString(value) })
          response.send(b4a.from('node-response'))
        }
      })
      const response = channel.addMessage({ encoding: c.buffer })
      channel.open()
    })
  })

  try {
    const discovery = server.join(core.discoveryKey, { server: true, client: false })
    await discovery.flushed()
    worker = PearRuntime.run(require.resolve('./pear-protomux-probe-worker.js'), [
      '--config', JSON.stringify({
        storagePath: path.join(root, 'pear'),
        bootstrap: testnet.bootstrap,
        coreKey: b4a.toString(core.key, 'hex'),
        protocolId: b4a.toString(protocolId, 'hex'),
        replicateDelayMs: 100
      })
    ])
    pipe = new FramedStream(worker, { bits: 24 })
    let stderr = ''
    worker.stderr?.on('data', (data) => { stderr += data.toString() })
    const result = await waitForProbe(pipe, 25_000)
    assert.equal(result.ok, true, JSON.stringify({ result, serverEvents, stderr, versions: packageVersions() }))
    assert.equal(result.events.some((event) => event.type === 'channel.open'), true)
    assert.equal(serverEvents.some((event) => event.type === 'pair'), true)
  } finally {
    pipe?.destroy()
    worker?.destroy()
    await server.destroy().catch(() => {})
    await store.close().catch(() => {})
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})

function packageVersions () {
  return Object.fromEntries([
    'pear-runtime',
    'hyperswarm',
    'hyperdht',
    'corestore',
    'protomux'
  ].map((name) => [name, require(`${name}/package`).version]))
}

function waitForProbe (pipe, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pear probe IPC timed out')), timeoutMs)
    pipe.once('data', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(b4a.toString(data)))
    })
  })
}
