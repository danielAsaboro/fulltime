'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const http = require('node:http')
const test = require('node:test')

const { BROWSER_ACTIONS, DesktopLocalHost, SESSION_COOKIE } = require('../lib/local-host.js')

const enabled = process.env.FULLTIME_RUN_LOCALHOST_TESTS === '1'

class FakePeerController extends EventEmitter {
  constructor () {
    super()
    this.requests = []
    this.events = []
    this.unavailable = null
  }

  bridgeConfig () {
    if (this.unavailable) throw this.unavailable
    return { protocolVersion: 2, mode: 'pear-p2p-rooms', maxRoomMembers: 256 }
  }

  replayEvents () {
    return this.events
  }

  async request (frame) {
    this.requests.push(frame)
    return { version: 2, id: frame.id, ok: true, result: { action: frame.action } }
  }
}

async function startUpstream () {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: `http://${request.headers.host}/target` })
      response.end()
      return
    }
    const body = `upstream:${request.url}`
    response.writeHead(200, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) })
    response.end(body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Upstream did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

async function startHost (t, peer = new FakePeerController()) {
  const upstream = await startUpstream()
  const host = new DesktopLocalHost({ peerController: peer, upstream: upstream.url })
  const url = await host.start()
  t.after(async () => {
    await host.close()
    await upstream.close()
  })
  return { host, peer, url }
}

async function exchange (host, url) {
  const capability = host.issueBrowserCapabilityUrl()
  const response = await fetch(capability, { redirect: 'manual' })
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), '/')
  assert.match(response.headers.get('set-cookie') || '', new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/api/peer; HttpOnly; SameSite=Strict$`))
  return response.headers.get('set-cookie').split(';', 1)[0]
}

function requestWithHost (url, host) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { headers: { host } }, (response) => {
      response.once('end', () => resolve(response.statusCode))
      response.resume()
    })
    request.once('error', reject)
    request.end()
  })
}

test('desktop local host exchanges a one-use capability for a strict memory-only browser session', {
  skip: enabled ? false : 'set FULLTIME_RUN_LOCALHOST_TESTS=1 to run loopback HTTP host tests'
}, async (t) => {
  const { host, peer, url } = await startHost(t)
  const unauthenticated = await fetch(`${url}/api/peer/config`, { headers: { origin: url } })
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.headers.get('access-control-allow-origin'), null)
  assert.equal(await requestWithHost(`${url}/_fulltime/health`, 'attacker.invalid'), 421)
  const redirect = await fetch(`${url}/redirect`, { redirect: 'manual' })
  assert.equal(redirect.headers.get('location'), '/target')

  const capability = host.issueBrowserCapabilityUrl()
  const exchanged = await fetch(capability, { redirect: 'manual' })
  const cookie = exchanged.headers.get('set-cookie').split(';', 1)[0]
  assert.equal(exchanged.status, 303)
  const reused = await fetch(capability, { redirect: 'manual' })
  assert.equal(reused.status, 403)

  const config = await fetch(`${url}/api/peer/config`, { headers: { origin: url, cookie } })
  assert.equal(config.status, 200)
  assert.deepEqual(await config.json(), { protocolVersion: 2, mode: 'pear-p2p-rooms', maxRoomMembers: 256 })
  const browserFetchConfig = await fetch(`${url}/api/peer/config`, {
    headers: { 'x-fulltime-local-origin': url, cookie }
  })
  assert.equal(browserFetchConfig.status, 200)
  const wrongOrigin = await fetch(`${url}/api/peer/config`, { headers: { origin: 'http://127.0.0.1:1', cookie } })
  assert.equal(wrongOrigin.status, 403)

  const response = await fetch(`${url}/api/peer/request`, {
    method: 'POST',
    headers: { origin: url, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ version: 2, id: 'browser-123', action: 'room.notification.settings', payload: { roomId: 'room-1' } })
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { version: 2, id: 'browser-123', ok: true, result: { action: 'room.notification.settings' } })
  assert.equal(peer.requests.length, 1)
  assert.equal(BROWSER_ACTIONS.has('room.notification.settings'), true)
  assert.equal(BROWSER_ACTIONS.has('notification.lifecycle'), false)
})

test('desktop local host replays bounded peer SSE events through the authenticated same worker bridge', {
  skip: enabled ? false : 'set FULLTIME_RUN_LOCALHOST_TESTS=1 to run loopback HTTP host tests'
}, async (t) => {
  const { host, peer, url } = await startHost(t)
  const cookie = await exchange(host, url)
  const event = { version: 2, type: 'bridge.ready', mode: 'pear-p2p-rooms', at: Date.now() }
  peer.emit('event', event)

  const stream = await fetch(`${url}/api/peer/events`, {
    headers: { 'x-fulltime-local-origin': url, cookie, 'x-fulltime-last-event-id': '0' }
  })
  assert.equal(stream.status, 200)
  assert.equal(stream.headers.get('access-control-allow-origin'), null)
  if (!stream.body) throw new Error('SSE stream has no body')
  const reader = stream.body.getReader()
  let output = ''
  try {
    while (!output.includes('event: peer')) {
      const next = await reader.read()
      if (next.done) throw new Error('SSE stream ended before replay')
      output += Buffer.from(next.value).toString('utf8')
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  assert.match(output, /id: 1/)
  assert.match(output, /"bridge\.ready"/)
})

test('desktop local host keeps the UI reachable but reports precise configuration unavailability without a worker', {
  skip: enabled ? false : 'set FULLTIME_RUN_LOCALHOST_TESTS=1 to run loopback HTTP host tests'
}, async (t) => {
  const peer = new FakePeerController()
  const unavailable = new Error('No verified FullTime manifest is available')
  unavailable.code = 'CONFIGURATION_UNAVAILABLE'
  peer.unavailable = unavailable
  const { host, url } = await startHost(t, peer)
  const cookie = await exchange(host, url)
  const response = await fetch(`${url}/api/peer/config`, { headers: { origin: url, cookie } })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: { code: 'CONFIGURATION_UNAVAILABLE', message: 'No verified FullTime manifest is available' }
  })
  await host.close()
  assert.equal(host.browserSessions.size, 0, 'Electron teardown must invalidate browser sessions')
})

test('desktop local host destroys keep-alive sockets during Electron teardown', {
  skip: enabled ? false : 'set FULLTIME_RUN_LOCALHOST_TESTS=1 to run loopback HTTP host tests'
}, async (t) => {
  const { host, url } = await startHost(t)
  const agent = new http.Agent({ keepAlive: true })
  t.after(() => agent.destroy())
  await new Promise((resolve, reject) => {
    const request = http.get(url, { agent }, (response) => {
      response.resume()
      response.once('end', resolve)
    })
    request.once('error', reject)
  })

  const outcome = await Promise.race([
    host.close().then(() => 'closed'),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 1_000))
  ])
  assert.equal(outcome, 'closed')
  assert.equal(host.sockets.size, 0)
})
