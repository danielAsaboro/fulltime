'use strict'

const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const b4a = require('b4a')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const {
  decodeFixtureProofRequest,
  encodeFixtureProof,
  frameFixtureProof
} = require('../../desktop/lib/fixture-proof-stream.js')
const { verifyNetworkManifest } = require('../../desktop/lib/network-manifest.js')

const packageRoot = path.resolve(__dirname, '..')
const runtimePath = path.join(packageRoot, '.local-development', 'replay-runtime.json')
const storagePath = path.join(packageRoot, '.local-development', 'fixture-relay')
const port = 59638

async function main () {
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  const manifest = verifyNetworkManifest(await readManifest(runtime), runtime.publicKey)
  const feedKey = manifest.fixtureFeedKey
  if (typeof feedKey !== 'string' || !/^[a-f0-9]{64}$/.test(feedKey)) {
    throw new Error('Authenticated replay fixture feed key is unavailable')
  }

  const host = localIpv4()
  const store = new Corestore(storagePath)
  await store.ready()
  const core = store.get({ key: b4a.from(feedKey, 'hex'), active: true })
  await core.ready()
  console.log(`[fulltime fixture relay] reader ready for ${feedKey}`)

  const upstream = new Hyperswarm()
  upstream.on('connection', (connection) => store.replicate(connection))
  const upstreamDiscovery = upstream.join(core.discoveryKey, { server: false, client: true })

  const sockets = new Set()
  let closing = false
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.once('error', () => {})
    void serveProofs(socket, core, () => closing).catch((error) => {
      if (!socket.destroyed) socket.destroy(error)
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', resolve)
  })
  console.log(`[fulltime fixture relay] local authenticated Hypercore proof stream ${feedKey} on ${host}:${port}`)

  const download = core.download({ start: 0, linear: true })
  void core.get(0).then(() => {
    console.log(`[fulltime fixture relay] verified publisher block 0; feed length ${core.length}`)
  }, (error) => {
    console.error('[fulltime fixture relay] upstream proof request failed', error)
  })

  const close = async () => {
    if (closing) return
    closing = true
    download.destroy()
    for (const socket of sockets) socket.destroy()
    await upstreamDiscovery.destroy().catch(() => {})
    await upstream.destroy().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
    await core.close().catch(() => {})
    await store.close().catch(() => {})
  }
  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })
}

async function serveProofs (socket, core, isClosing) {
  const request = await readProofRequest(socket)
  let remoteLength = request.length
  let index = request.start
  while (!isClosing() && !socket.destroyed) {
    if (index >= core.length) {
      await waitForAppend(core, socket)
      continue
    }
    const headLength = core.length
    const options = { block: { index, nodes: 0 } }
    if (remoteLength < headLength) {
      options.upgrade = { start: remoteLength, length: headLength - remoteLength }
      remoteLength = headLength
    }
    const block = await core.get(index)
    const proof = await core.proof(options)
    proof.block.value = block
    proof.manifest = core.core.header.manifest
    const frame = frameFixtureProof(encodeFixtureProof({ index, proof }))
    if (!socket.write(frame)) await once(socket, 'drain')
    await readProofAck(socket)
    index++
  }
}

function readProofRequest (socket) {
  return new Promise((resolve, reject) => {
    let buffered = b4a.alloc(0)
    const cleanup = () => {
      socket.removeListener('data', onData)
      socket.removeListener('close', onClose)
      socket.removeListener('error', onError)
    }
    const onClose = () => { cleanup(); reject(new Error('Fixture proof client closed before requesting a stream')) }
    const onError = (error) => { cleanup(); reject(error) }
    const onData = (chunk) => {
      buffered = b4a.concat([buffered, chunk])
      if (buffered.byteLength > 256) {
        cleanup()
        reject(new RangeError('Fixture proof request exceeds the byte limit'))
        return
      }
      const newline = buffered.indexOf(0x0a)
      if (newline < 0) return
      if (newline !== buffered.byteLength - 1) {
        cleanup()
        reject(new TypeError('Fixture proof request contains trailing data'))
        return
      }
      try {
        const request = decodeFixtureProofRequest(buffered.subarray(0, newline))
        cleanup()
        resolve(request)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    socket.on('data', onData)
    socket.once('close', onClose)
    socket.once('error', onError)
  })
}

function waitForAppend (core, socket) {
  if (socket.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      core.removeListener('append', finish)
      socket.removeListener('close', finish)
      resolve()
    }
    const timer = setTimeout(finish, 1_000)
    core.once('append', finish)
    socket.once('close', finish)
  })
}

function readProofAck (socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeListener('data', onData)
      socket.removeListener('close', onClose)
      socket.removeListener('error', onError)
    }
    const onClose = () => { cleanup(); reject(new Error('Fixture proof client closed before acknowledging a block')) }
    const onError = (error) => { cleanup(); reject(error) }
    const onData = (chunk) => {
      cleanup()
      if (chunk.byteLength !== 1 || chunk[0] !== 0x06) {
        reject(new TypeError('Fixture proof client sent an invalid acknowledgement'))
      } else {
        resolve()
      }
    }
    socket.once('data', onData)
    socket.once('close', onClose)
    socket.once('error', onError)
  })
}

function once (emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve))
}

function localIpv4 () {
  for (const entries of Object.values(os.networkInterfaces())) {
    const candidate = entries?.find((entry) => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    if (candidate) return candidate.address
  }
  throw new Error('A LAN IPv4 address is required for the mobile fixture relay')
}

async function readManifest (runtime) {
  const https = require('https')
  return new Promise((resolve, reject) => {
    const request = https.get(runtime.endpoint, {
      ca: fs.readFileSync(runtime.caCertificatePath),
      rejectUnauthorized: true
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Replay manifest returned HTTP ${response.statusCode}`))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
      })
    })
    request.once('error', reject)
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
