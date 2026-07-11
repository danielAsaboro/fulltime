'use strict'

const b4a = require('b4a')
const FramedStream = require('framed-stream')
const Hyperswarm = require('hyperswarm')

const config = JSON.parse(Bare.argv[3])
const pipe = new FramedStream(Bare.IPC, { bits: 24 })
const swarm = new Hyperswarm({ bootstrap: config.bootstrap, maxPeers: 4 })
const topic = b4a.from(config.topic, 'hex')
const events = []
let finished = false

function send (result) {
  if (finished) return
  finished = true
  pipe.write(b4a.from(JSON.stringify({
    ...result,
    bareVersion: Bare.version || null,
    swarmPublicKey: b4a.toString(swarm.keyPair.publicKey, 'hex'),
    events
  })))
}

swarm.on('connection', (connection, peerInfo) => {
  events.push({
    type: 'connection',
    client: peerInfo.client,
    connected: connection.connected,
    remotePublicKey: b4a.toString(connection.remotePublicKey, 'hex')
  })
  connection.on('error', (error) => events.push({ type: 'connection.error', code: error.code, message: error.message }))
  connection.on('close', () => events.push({
    type: 'connection.close',
    connected: connection.connected,
    rawBytesRead: connection.rawBytesRead,
    rawBytesWritten: connection.rawBytesWritten
  }))
  connection.on('data', (data) => {
    events.push({ type: 'data', value: b4a.toString(data) })
    if (b4a.toString(data) === 'node-pong') send({ ok: true })
  })
  connection.write(b4a.from('pear-ping'))
})
swarm.on('error', (error) => events.push({ type: 'swarm.error', code: error.code, message: error.message }))

async function main () {
  const discovery = swarm.join(topic, { server: false, client: true })
  await discovery.flushed()
  events.push({ type: 'flushed' })
  setTimeout(() => send({
    ok: false,
    error: 'timeout',
    connections: swarm.connections.size
  }), 15_000).unref?.()
}

main().catch((error) => send({ ok: false, error: error.message, code: error.code }))
