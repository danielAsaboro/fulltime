'use strict'

const b4a = require('b4a')
const c = require('compact-encoding')
const Corestore = require('corestore')
const FramedStream = require('framed-stream')
const Hyperswarm = require('hyperswarm')
const Protomux = require('protomux')

const config = JSON.parse(Bare.argv[3])
const pipe = new FramedStream(Bare.IPC, { bits: 24 })
const events = []
let finished = false

function send (result) {
  if (finished) return
  finished = true
  pipe.write(b4a.from(JSON.stringify({ ...result, bareVersion: Bare.version || null, events })))
}

async function main () {
  const store = new Corestore(config.storagePath)
  await store.ready()
  const core = store.get({ key: b4a.from(config.coreKey, 'hex'), active: true })
  await core.ready()
  const swarm = new Hyperswarm({ bootstrap: config.bootstrap, maxPeers: 4 })
  const descriptor = {
    protocol: 'fulltime/protomux-interop/1',
    id: b4a.from(config.protocolId, 'hex')
  }
  swarm.on('connection', (connection, peerInfo) => {
    events.push({ type: 'connection', client: peerInfo.client })
    connection.on('error', (error) => events.push({ type: 'connection.error', code: error.code, message: error.message }))
    connection.on('close', () => events.push({
      type: 'connection.close',
      rawBytesRead: connection.rawBytesRead,
      rawBytesWritten: connection.rawBytesWritten
    }))
    setTimeout(() => {
      events.push({ type: 'replicate.start', delay: config.replicateDelayMs || 0 })
      store.replicate(connection)
      const mux = Protomux.from(connection)
      const channel = mux.createChannel({
        ...descriptor,
        onopen: () => {
          events.push({ type: 'channel.open' })
          request.send(b4a.from('pear-request'))
        },
        onclose: () => events.push({ type: 'channel.close' })
      })
      const request = channel.addMessage({ encoding: c.buffer })
      channel.addMessage({
        encoding: c.buffer,
        onmessage: (value) => {
          events.push({ type: 'response', value: b4a.toString(value) })
          send({ ok: b4a.toString(value) === 'node-response' })
        }
      })
      channel.open()
    }, config.replicateDelayMs || 0)
  })
  swarm.on('error', (error) => events.push({ type: 'swarm.error', code: error.code, message: error.message }))
  const discovery = swarm.join(core.discoveryKey, { server: false, client: true })
  await discovery.flushed()
  events.push({ type: 'flushed' })
  setTimeout(() => send({
    ok: false,
    error: 'timeout',
    connections: swarm.connections.size,
    coreLength: core.length
  }), 15_000).unref?.()
}

main().catch((error) => send({ ok: false, error: error.message, code: error.code }))
