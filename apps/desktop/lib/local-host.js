'use strict'

const crypto = require('crypto')
const http = require('http')
const https = require('https')
const net = require('net')

const {
  ROOM_ACTIONS,
  ROOM_IPC_VERSION,
  errorResponse,
  validateRequest,
  validateResponse
} = require('./room-protocol.js')

const LOOPBACK_HOST = '127.0.0.1'
const SESSION_COOKIE = 'fulltime_local_browser_session'
const CAPABILITY_TTL_MS = 5 * 60 * 1000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_EVENT_BACKLOG = 100
const MAX_BROWSER_SESSIONS = 32
const MAX_SSE_SUBSCRIPTIONS_PER_SESSION = 2

const BROWSER_ACTIONS = new Set([...ROOM_ACTIONS].filter((action) => ![
  'system.config',
  'system.close',
  'room.list',
  'notification.pending',
  'notification.lifecycle'
].includes(action)))

class LocalHostError extends Error {
  constructor (status, code, message, options = undefined) {
    super(message, options)
    this.name = 'LocalHostError'
    this.status = status
    this.code = code
  }
}

/**
 * Loopback-only HTTP host owned by the Electron process.  It deliberately has
 * no CORS surface: an external browser gains access only by exchanging the
 * one-use capability Electron opens, and all browser requests then enter the
 * same DesktopPeerController used by the preload bridge.
 */
class DesktopLocalHost {
  constructor ({
    peerController,
    upstream = undefined,
    startUpstream = undefined,
    port = 0,
    openExternal = undefined,
    now = () => Date.now(),
    capabilityTtlMs = CAPABILITY_TTL_MS,
    maxBrowserSessions = MAX_BROWSER_SESSIONS,
    maxSseSubscriptionsPerSession = MAX_SSE_SUBSCRIPTIONS_PER_SESSION
  }) {
    if (!peerController || typeof peerController.bridgeConfig !== 'function' || typeof peerController.request !== 'function' ||
        typeof peerController.on !== 'function' || typeof peerController.removeListener !== 'function') {
      throw new TypeError('Desktop local host requires a DesktopPeerController')
    }
    if (upstream !== undefined && startUpstream !== undefined) {
      throw new TypeError('Desktop local host accepts either an upstream URL or an upstream starter, not both')
    }
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Desktop local host port must be 0-65535')
    if (openExternal !== undefined && typeof openExternal !== 'function') throw new TypeError('Browser opener must be a function')
    if (typeof now !== 'function') throw new TypeError('Desktop local host clock must be a function')
    if (!Number.isSafeInteger(capabilityTtlMs) || capabilityTtlMs < 1_000 || capabilityTtlMs > 15 * 60 * 1000) {
      throw new TypeError('Browser capability lifetime must be 1000-900000 milliseconds')
    }
    if (!Number.isSafeInteger(maxBrowserSessions) || maxBrowserSessions < 1 || maxBrowserSessions > 256) {
      throw new TypeError('Maximum browser sessions must be 1-256')
    }
    if (!Number.isSafeInteger(maxSseSubscriptionsPerSession) || maxSseSubscriptionsPerSession < 1 || maxSseSubscriptionsPerSession > 8) {
      throw new TypeError('Maximum SSE subscriptions per browser session must be 1-8')
    }

    this.peerController = peerController
    this.port = port
    this.openExternal = openExternal || null
    this.now = now
    this.capabilityTtlMs = capabilityTtlMs
    this.maxBrowserSessions = maxBrowserSessions
    this.maxSseSubscriptionsPerSession = maxSseSubscriptionsPerSession
    this.upstream = upstream === undefined ? null : normalizeUpstream(upstream)
    this.startUpstream = startUpstream || null
    this.upstreamHandle = null
    this.server = null
    this.sockets = new Set()
    this.origin = null
    this.closed = false
    this.closing = null
    this.capabilities = new Map()
    this.browserSessions = new Map()
    this.events = []
    this.nextEventId = 1
    this._onPeerEvent = (event) => this.publishEvent(event)
  }

  get url () {
    return this.origin
  }

  async start () {
    if (this.closed) throw new Error('Desktop local host is closed')
    if (this.server) return this.origin
    await this._openUpstream()
    const server = http.createServer((request, response) => {
      void this.handle(request, response)
    })
    this.server = server
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.once('close', () => this.sockets.delete(socket))
    })
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    })
    server.on('upgrade', (request, socket, head) => this.proxyUpgrade(request, socket, head))
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.port, LOOPBACK_HOST, resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
      await this.close()
      throw new Error('Desktop local host did not bind to IPv4 loopback')
    }
    this.origin = `http://${LOOPBACK_HOST}:${address.port}`
    this.peerController.on('event', this._onPeerEvent)
    for (const event of this.peerController.replayEvents?.() || []) this.publishEvent(event)
    return this.origin
  }

  issueBrowserCapabilityUrl () {
    if (!this.origin || this.closed) throw new Error('Desktop local host is not running')
    this.pruneCapabilities()
    const token = crypto.randomBytes(32).toString('base64url')
    this.capabilities.set(token, { expiresAt: this.now() + this.capabilityTtlMs })
    return `${this.origin}/api/peer/capability?token=${encodeURIComponent(token)}`
  }

  async openInBrowser () {
    const url = this.issueBrowserCapabilityUrl()
    if (this.openExternal) await this.openExternal(url)
    return url
  }

  async handle (request, response) {
    try {
      if (!this.isExpectedHost(request)) {
        throw new LocalHostError(421, 'HOST_FORBIDDEN', 'FullTime accepts requests only for its exact loopback host')
      }
      const url = new URL(request.url || '/', this.origin || `http://${LOOPBACK_HOST}`)
      if (url.pathname === '/_fulltime/health' && request.method === 'GET') {
        writeJson(response, 200, { ok: true })
        return
      }
      if (url.pathname === '/api/peer' || url.pathname.startsWith('/api/peer/')) {
        await this.handlePeer(request, response, url)
        return
      }
      await this.proxyRequest(request, response)
    } catch (error) {
      writeError(response, error)
    }
  }

  async handlePeer (request, response, url) {
    const endpoint = url.pathname.slice('/api/peer'.length)
    if (endpoint === '/capability') {
      await this.exchangeCapability(request, response, url)
      return
    }
    if (endpoint === '/config' && request.method === 'GET') {
      this.requireBrowserSession(request)
      writeJson(response, 200, this.peerController.bridgeConfig())
      return
    }
    if (endpoint === '/events' && request.method === 'GET') {
      const session = this.requireBrowserSession(request)
      this.peerController.bridgeConfig()
      this.openEventStream(request, response, session)
      return
    }
    if (endpoint === '/request' && request.method === 'POST') {
      this.requireBrowserSession(request)
      const input = await readJson(request)
      let frame
      try {
        frame = validateRequest(input)
      } catch (error) {
        throw new LocalHostError(400, 'INVALID_REQUEST', error instanceof Error ? error.message : 'Peer request frame is invalid', { cause: error })
      }
      if (!BROWSER_ACTIONS.has(frame.action)) {
        throw new LocalHostError(403, 'ACTION_FORBIDDEN', 'This peer action is not available to the browser bridge')
      }
      try {
        const output = validateResponse(await this.peerController.request(frame))
        if (output.id !== frame.id) throw new Error('Desktop peer controller returned a mismatched response ID')
        writeJson(response, 200, output)
      } catch (error) {
        writeJson(response, 200, errorResponse(frame.id, error))
      }
      return
    }
    throw new LocalHostError(404, 'NOT_FOUND', 'The requested local peer endpoint does not exist')
  }

  async exchangeCapability (request, response, url) {
    if (request.method !== 'GET') throw new LocalHostError(405, 'METHOD_NOT_ALLOWED', 'Browser capability exchange requires GET')
    const origin = request.headers.origin
    if (origin !== undefined && origin !== this.origin) {
      throw new LocalHostError(403, 'ORIGIN_FORBIDDEN', 'Browser capability exchange came from an unexpected origin')
    }
    const tokens = url.searchParams.getAll('token')
    if (tokens.length !== 1 || !isSecret(tokens[0]) || [...url.searchParams.keys()].length !== 1) {
      throw new LocalHostError(400, 'CAPABILITY_INVALID', 'Browser capability URL is invalid')
    }
    this.pruneCapabilities()
    const capability = this.capabilities.get(tokens[0])
    this.capabilities.delete(tokens[0])
    if (!capability || capability.expiresAt <= this.now()) {
      throw new LocalHostError(403, 'CAPABILITY_EXPIRED', 'Browser capability has expired or was already used')
    }
    if (this.browserSessions.size >= this.maxBrowserSessions) {
      throw new LocalHostError(503, 'SESSION_CAPACITY', 'FullTime has reached its local browser session capacity')
    }
    const id = crypto.randomBytes(32).toString('base64url')
    this.browserSessions.set(id, { sse: new Set() })
    response.writeHead(303, {
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=${id}; Path=/api/peer; HttpOnly; SameSite=Strict`,
      'Cache-Control': 'no-store',
      'Content-Length': '0'
    })
    response.end()
  }

  requireBrowserSession (request) {
    const origin = request.headers.origin
    const declaredOrigin = request.headers['x-fulltime-local-origin']
    if ((origin !== undefined && origin !== this.origin) ||
        (declaredOrigin !== undefined && declaredOrigin !== this.origin) ||
        (origin !== this.origin && declaredOrigin !== this.origin)) {
      throw new LocalHostError(403, 'ORIGIN_FORBIDDEN', 'The local peer bridge requires its exact loopback origin')
    }
    const id = readCookie(request.headers.cookie, SESSION_COOKIE)
    if (!id) throw new LocalHostError(401, 'SESSION_REQUIRED', 'Open FullTime in your browser from the Electron application first')
    const session = this.browserSessions.get(id)
    if (!session) throw new LocalHostError(401, 'SESSION_EXPIRED', 'This browser session is no longer active')
    return session
  }

  openEventStream (request, response, session) {
    if (session.sse.size >= this.maxSseSubscriptionsPerSession) {
      throw new LocalHostError(429, 'SSE_CAPACITY', 'Too many peer event streams are open in this browser session')
    }
    const nativeLastEventId = request.headers['last-event-id']
    const declaredLastEventId = request.headers['x-fulltime-last-event-id']
    const lastEventId = parseSseCursor(nativeLastEventId, declaredLastEventId)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    response.write(': connected\n\n')
    const client = { response, session }
    session.sse.add(client)
    for (const entry of this.events) {
      if (entry.id > lastEventId) this.writeEvent(client, entry)
    }
    const heartbeat = setInterval(() => {
      try {
        response.write(': keepalive\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 25_000)
    heartbeat.unref?.()
    const close = () => {
      clearInterval(heartbeat)
      session.sse.delete(client)
    }
    request.once('close', close)
    response.once('close', close)
  }

  publishEvent (event) {
    if (this.closed) return
    const entry = { id: this.nextEventId++, event }
    this.events.push(entry)
    if (this.events.length > MAX_EVENT_BACKLOG) this.events.shift()
    for (const session of this.browserSessions.values()) {
      for (const client of [...session.sse]) this.writeEvent(client, entry)
    }
  }

  writeEvent (client, entry) {
    try {
      client.response.write(`id: ${entry.id}\nevent: peer\ndata: ${JSON.stringify(entry.event)}\n\n`)
    } catch {
      client.session.sse.delete(client)
    }
  }

  async proxyRequest (request, response) {
    if (!this.upstream) throw new LocalHostError(503, 'UI_UNAVAILABLE', 'The private FullTime web renderer is unavailable')
    const target = new URL(request.url || '/', this.upstream)
    if (target.origin !== this.upstream.origin) throw new LocalHostError(400, 'INVALID_PATH', 'The requested UI path is invalid')
    const transport = target.protocol === 'https:' ? https : http
    const headers = { ...request.headers, host: target.host }
    delete headers.connection
    await new Promise((resolve, reject) => {
      const upstreamRequest = transport.request(target, {
        method: request.method,
        headers
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, this.rewriteProxyHeaders(upstreamResponse.headers))
        upstreamResponse.pipe(response)
        upstreamResponse.once('error', reject)
        response.once('finish', resolve)
      })
      upstreamRequest.once('error', reject)
      request.pipe(upstreamRequest)
    }).catch((error) => {
      if (!response.headersSent) throw new LocalHostError(502, 'UI_UNAVAILABLE', 'The private FullTime web renderer is unavailable', { cause: error })
      try {
        response.destroy(error)
      } catch {}
    })
  }

  proxyUpgrade (request, socket, head) {
    if (!this.isExpectedHost(request) || !this.upstream || request.url === '/api/peer' || request.url?.startsWith('/api/peer/')) {
      socket.destroy()
      return
    }
    const target = new URL(request.url || '/', this.upstream)
    if (target.origin !== this.upstream.origin || target.protocol !== 'http:') {
      socket.destroy()
      return
    }
    const upstreamSocket = net.connect(Number(target.port || 80), target.hostname)
    upstreamSocket.once('connect', () => {
      const headerLines = [
        `${request.method} ${target.pathname}${target.search} HTTP/${request.httpVersion}`,
        ...Object.entries({ ...request.headers, host: target.host }).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`),
        '',
        ''
      ]
      upstreamSocket.write(headerLines.join('\r\n'))
      if (head?.byteLength) upstreamSocket.write(head)
      socket.pipe(upstreamSocket).pipe(socket)
    })
    upstreamSocket.once('error', () => socket.destroy())
    socket.once('error', () => upstreamSocket.destroy())
  }

  rewriteProxyHeaders (headers) {
    const output = filterProxyHeaders(headers)
    if (typeof output.location !== 'string' || !this.upstream) return output
    try {
      const location = new URL(output.location, this.upstream)
      if (location.origin === this.upstream.origin) output.location = `${location.pathname}${location.search}${location.hash}`
    } catch {}
    return output
  }

  isExpectedHost (request) {
    return Boolean(this.origin) && request.headers.host === `${LOOPBACK_HOST}:${new URL(this.origin).port}`
  }

  pruneCapabilities () {
    const now = this.now()
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.capabilities.delete(token)
    }
  }

  async _openUpstream () {
    if (this.upstream) return
    if (typeof this.startUpstream !== 'function') throw new Error('Desktop local host needs a private Next upstream')
    const result = await this.startUpstream()
    if (typeof result === 'string' || result instanceof URL) {
      this.upstream = normalizeUpstream(result)
      return
    }
    if (!result || typeof result !== 'object') throw new Error('Desktop web upstream returned an invalid handle')
    this.upstream = normalizeUpstream(result.url)
    this.upstreamHandle = result
  }

  async close () {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this._close()
    return this.closing
  }

  async _close () {
    this.capabilities.clear()
    for (const session of this.browserSessions.values()) {
      for (const client of session.sse) {
        try {
          client.response.end()
        } catch {}
      }
      session.sse.clear()
    }
    this.browserSessions.clear()
    this.peerController.removeListener('event', this._onPeerEvent)
    const server = this.server
    this.server = null
    if (server) {
      const closed = new Promise((resolve) => server.close(resolve))
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      await closed
    }
    if (this.upstreamHandle?.close) await this.upstreamHandle.close()
    this.upstreamHandle = null
    this.events.length = 0
  }
}

function normalizeUpstream (value) {
  let url
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value)
  } catch (error) {
    throw new TypeError('Desktop web upstream URL is invalid', { cause: error })
  }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash ||
      !isLoopbackHostname(url.hostname)) {
    throw new TypeError('Desktop web upstream must be a credential-free HTTP loopback URL')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function isLoopbackHostname (hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || (net.isIP(normalized) === 4 && normalized.split('.')[0] === '127')
}

function readCookie (header, name) {
  if (typeof header !== 'string' || header.length > 8_192) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    if (part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    return isSecret(value) ? value : null
  }
  return null
}

function isSecret (value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

function parseLastEventId (value) {
  if (value === undefined) return 0
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})$/.test(value)) {
    throw new LocalHostError(400, 'INVALID_EVENT_CURSOR', 'SSE event cursor is invalid')
  }
  const id = Number(value)
  if (!Number.isSafeInteger(id)) throw new LocalHostError(400, 'INVALID_EVENT_CURSOR', 'SSE event cursor is invalid')
  return id
}

function parseSseCursor (nativeValue, declaredValue) {
  const nativeCursor = parseLastEventId(nativeValue)
  const declaredCursor = parseLastEventId(declaredValue)
  if (nativeValue !== undefined && declaredValue !== undefined && nativeCursor !== declaredCursor) {
    throw new LocalHostError(400, 'INVALID_EVENT_CURSOR', 'SSE event cursors do not agree')
  }
  return declaredValue === undefined ? nativeCursor : declaredCursor
}

async function readJson (request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += value.byteLength
    if (total > MAX_BODY_BYTES) throw new LocalHostError(413, 'BODY_TOO_LARGE', 'Peer requests may not exceed 2 MiB')
    chunks.push(value)
  }
  if (total < 1) throw new LocalHostError(400, 'BODY_REQUIRED', 'Peer requests require a JSON body')
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
  } catch (error) {
    throw new LocalHostError(400, 'INVALID_JSON', 'Peer requests must contain valid JSON', { cause: error })
  }
}

function filterProxyHeaders (headers) {
  const output = { ...headers }
  for (const name of Object.keys(output)) {
    if (name.toLowerCase().startsWith('access-control-')) delete output[name]
  }
  return output
}

function writeJson (response, status, value) {
  if (response.headersSent) return
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(body)
}

function writeError (response, error) {
  if (response.headersSent) {
    try {
      response.end()
    } catch {}
    return
  }
  const status = error instanceof LocalHostError ? error.status : (error?.code === 'CONFIGURATION_UNAVAILABLE' ? 503 : 500)
  const code = error instanceof LocalHostError ? error.code : (error?.code === 'CONFIGURATION_UNAVAILABLE' ? error.code : 'LOCAL_HOST_FAILURE')
  const message = error instanceof Error && error.message ? error.message : 'The local FullTime host failed'
  writeJson(response, status, { error: { code, message } })
}

module.exports = {
  BROWSER_ACTIONS,
  CAPABILITY_TTL_MS,
  DesktopLocalHost,
  LocalHostError,
  MAX_BODY_BYTES,
  MAX_BROWSER_SESSIONS,
  MAX_EVENT_BACKLOG,
  MAX_SSE_SUBSCRIPTIONS_PER_SESSION,
  SESSION_COOKIE
}
