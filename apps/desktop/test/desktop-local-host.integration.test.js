'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const b4a = require('b4a')
const createTestnet = require('hyperdht/testnet')

const { DesktopPeerController } = require('../lib/desktop-peer-controller.js')
const { DesktopLocalHost } = require('../lib/local-host.js')
const { signNetworkManifest } = require('../lib/network-manifest.js')
const { RoomManager } = require('../workers/room-manager.js')
const { SignedFixturePublisher } = require('./signed-fixture-publisher.js')

const enabled = process.env.FULLTIME_RUN_PEAR_INTEGRATION === '1'

function delay (milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitFor (loader, label, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await loader()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(75)
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`)
}

async function startUpstream () {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>FullTime test host</title>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test UI upstream did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

async function dispatch (controller, action, payload) {
  const response = await controller.request({ version: 2, id: crypto.randomUUID(), action, payload })
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
  return response.result
}

async function browserRequest (url, cookie, action, payload) {
  const id = `browser-${crypto.randomUUID()}`
  const response = await fetch(`${url}/api/peer/request`, {
    method: 'POST',
    headers: { origin: url, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ version: 2, id, action, payload })
  })
  assert.equal(response.status, 200)
  const frame = await response.json()
  assert.equal(frame.id, id)
  if (!frame.ok) throw new Error(`${frame.error.code}: ${frame.error.message}`)
  return frame.result
}

test('one Electron-owned peer identity serves preload IPC and a capability-authorized normal browser session', {
  skip: enabled ? false : 'set FULLTIME_RUN_PEAR_INTEGRATION=1 to run the same-peer local-DHT and loopback-host integration',
  timeout: 150_000
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-desktop-local-host-'))
  const testnet = await createTestnet(3, { host: '127.0.0.1' })
  const fixture = {
    id: 'desktop-local-host-fixture',
    competition: 'Test Cup',
    home: { id: 'home', name: 'Home' },
    away: { id: 'away', name: 'Away' },
    kickoff: Date.now() + 60_000,
    status: 'scheduled'
  }
  const publisher = new SignedFixturePublisher({
    storagePath: path.join(root, 'fixture-publisher'),
    bootstrap: testnet.bootstrap
  })
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const controller = new DesktopPeerController({
    storagePath: path.join(root, 'electron-peer'),
    displayName: 'Desktop fan',
    manifestPublicKey: publicKey
  })
  const memberSecret = crypto.randomBytes(32)
  let member = null
  let host = null
  let upstream = null

  try {
    await publisher.open()
    await publisher.publishFixture(fixture)
    await controller.start({
      deviceSecret: b4a.from(crypto.randomBytes(32)),
      bootstrap: testnet.bootstrap,
      networkResolution: {
        source: 'network',
        stale: false,
        manifest: signNetworkManifest({
          version: 1,
          issuedAt: Date.now(),
          fixtureFeedKey: publisher.key
        }, privateKey)
      }
    })
    await controller.waitUntilReady()
    await waitFor(async () => Boolean(await dispatch(controller, 'fixture.get', { fixtureId: fixture.id })), 'controller fixture verification')

    upstream = await startUpstream()
    host = new DesktopLocalHost({ peerController: controller, upstream: upstream.url })
    const url = await host.start()
    const capability = host.issueBrowserCapabilityUrl()
    const exchanged = await fetch(capability, { redirect: 'manual' })
    assert.equal(exchanged.status, 303)
    const cookie = exchanged.headers.get('set-cookie').split(';', 1)[0]

    const preloadSession = await dispatch(controller, 'session.get', null)
    const browserSession = await browserRequest(url, cookie, 'session.get', null)
    assert.equal(browserSession.userId, preloadSession.userId, 'browser must use the Electron-owned account identity')

    const details = await dispatch(controller, 'room.create', {
      fixtureId: fixture.id,
      roomName: 'Same peer room',
      displayName: 'Desktop fan'
    })
    member = new RoomManager({
      storagePath: path.join(root, 'member-peer'),
      displayName: 'Invited fan',
      fixtureFeedKey: publisher.key,
      deviceSecret: memberSecret,
      bootstrap: testnet.bootstrap
    })
    await member.open()
    await waitFor(async () => Boolean(await member.dispatch('fixture.get', { fixtureId: fixture.id })), 'invited member fixture verification')
    const joined = await member.dispatch('room.join', { code: details.invite.code })
    assert.equal(joined.room.id, details.room.id, 'real BlindPairing invite admission must reach the same desktop room')

    const message = await member.dispatch('room.message.send', {
      roomId: details.room.id,
      input: { text: 'Message replicated into the Electron-owned room.' }
    })
    const browserState = await waitFor(async () => {
      const state = await browserRequest(url, cookie, 'room.state', { roomId: details.room.id })
      return state.items.some((item) => item.id === message.id) ? state : null
    }, 'browser room-state replication')
    const preloadState = await dispatch(controller, 'room.state', { roomId: details.room.id })
    assert.equal(preloadState.items.some((item) => item.id === message.id), true)
    assert.equal(browserState.items.some((item) => item.id === message.id), true)

    const browserSettings = await browserRequest(url, cookie, 'room.notification.settings.update', {
      roomId: details.room.id,
      settings: { messages: false }
    })
    assert.equal(browserSettings.messages, false)
    assert.equal((await dispatch(controller, 'room.notification.settings', { roomId: details.room.id })).messages, false)
  } finally {
    memberSecret.fill(0)
    await host?.close().catch(() => {})
    await upstream?.close().catch(() => {})
    await controller.close().catch(() => {})
    await member?.close().catch(() => {})
    await publisher.close().catch(() => {})
    await testnet.destroy().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
})
