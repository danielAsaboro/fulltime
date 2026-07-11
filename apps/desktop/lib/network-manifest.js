'use strict'

/**
 * FullTime's public network configuration is a small signed document.  It is
 * deliberately separate from room data: a room writer must never be able to
 * select the fixture publisher or answer authorities used by another peer.
 */

const crypto = require('crypto')
const fs = require('fs/promises')
const net = require('net')
const path = require('path')

const { normalizeFixtureFeedKey } = require('./config.js')

const NETWORK_MANIFEST_VERSION = 1
const MAX_MANIFEST_BYTES = 16 * 1024
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/
const MAX_FUTURE_ISSUED_AT_MS = 24 * 60 * 60 * 1000

class NetworkManifestError extends Error {
  constructor (code, message, options = undefined) {
    super(message, options)
    this.name = 'NetworkManifestError'
    this.code = code
  }
}

class ConfigurationUnavailableError extends Error {
  constructor (message, options = undefined) {
    super(message, options)
    this.name = 'ConfigurationUnavailableError'
    this.code = 'CONFIGURATION_UNAVAILABLE'
  }
}

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys (value, allowed) {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key))
}

function normalizeIssuedAt (value, now = Date.now()) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest issuedAt must be a non-negative millisecond timestamp')
  }
  if (value > now + MAX_FUTURE_ISSUED_AT_MS) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest issuedAt is implausibly far in the future')
  }
  return value
}

function parseAnswerAttestor (value) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['servicePublicKey', 'receiptFeedKey'])) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest answerAttestor pins are invalid')
  }
  try {
    return {
      servicePublicKey: normalizeFixtureFeedKey(value.servicePublicKey),
      receiptFeedKey: normalizeFixtureFeedKey(value.receiptFeedKey)
    }
  } catch (error) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest answerAttestor pins must be 32-byte lowercase hex keys', { cause: error })
  }
}

function parseAnchorObserver (value) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['publicKey', 'endpoint'])) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest anchorObserver pin is invalid')
  }
  let endpoint
  try {
    endpoint = new URL(value.endpoint)
  } catch (error) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest anchorObserver endpoint is invalid', { cause: error })
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest anchorObserver endpoint must be credential-free HTTPS')
  }
  try {
    return {
      publicKey: normalizeFixtureFeedKey(value.publicKey),
      endpoint: endpoint.toString()
    }
  } catch (error) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest anchorObserver public key must be 32-byte lowercase hex', { cause: error })
  }
}

function parseUnsignedNetworkManifest (value, now = Date.now()) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['version', 'issuedAt', 'fixtureFeedKey', 'answerAttestor', 'anchorObserver'])) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest has an invalid schema')
  }
  if (value.version !== NETWORK_MANIFEST_VERSION) {
    throw new NetworkManifestError('UNSUPPORTED_VERSION', `Network manifest version must be ${NETWORK_MANIFEST_VERSION}`)
  }

  let fixtureFeedKey
  try {
    fixtureFeedKey = normalizeFixtureFeedKey(value.fixtureFeedKey)
  } catch (error) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest fixtureFeedKey must be a 32-byte lowercase hex key', { cause: error })
  }

  const manifest = {
    version: NETWORK_MANIFEST_VERSION,
    issuedAt: normalizeIssuedAt(value.issuedAt, now),
    fixtureFeedKey
  }
  if (Object.hasOwn(value, 'answerAttestor')) manifest.answerAttestor = parseAnswerAttestor(value.answerAttestor)
  if (Object.hasOwn(value, 'anchorObserver')) manifest.anchorObserver = parseAnchorObserver(value.anchorObserver)
  return manifest
}

function parseNetworkManifest (value, now = Date.now()) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['version', 'issuedAt', 'fixtureFeedKey', 'answerAttestor', 'anchorObserver', 'signature'])) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest has an invalid schema')
  }
  if (typeof value.signature !== 'string' || !SIGNATURE_PATTERN.test(value.signature)) {
    throw new NetworkManifestError('INVALID_SCHEMA', 'Network manifest signature is invalid')
  }
  const { signature: _signature, ...payload } = value
  const unsigned = parseUnsignedNetworkManifest(payload, now)
  return { ...unsigned, signature: value.signature }
}

function canonicalize (value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Canonical JSON does not allow non-finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (!isPlainObject(value)) throw new TypeError('Canonical JSON accepts only plain objects and arrays')
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}'
}

function canonicalNetworkManifest (value, now = Date.now()) {
  return canonicalize(parseUnsignedNetworkManifest(value, now))
}

function signNetworkManifest (value, privateKey, now = Date.now()) {
  if (!privateKey) throw new TypeError('A manifest signing private key is required')
  const manifest = parseUnsignedNetworkManifest(value, now)
  const signature = crypto.sign(null, Buffer.from(canonicalize(manifest)), privateKey).toString('base64url')
  return { ...manifest, signature }
}

function verifyNetworkManifest (value, publicKey, now = Date.now()) {
  if (!publicKey) throw new TypeError('A manifest verification public key is required')
  const manifest = parseNetworkManifest(value, now)
  let signature
  try {
    signature = Buffer.from(manifest.signature, 'base64url')
  } catch (error) {
    throw new NetworkManifestError('INVALID_SIGNATURE', 'Network manifest signature is not decodable', { cause: error })
  }
  if (signature.byteLength !== 64 || !crypto.verify(null, Buffer.from(canonicalize(manifestPayload(manifest))), publicKey, signature)) {
    throw new NetworkManifestError('INVALID_SIGNATURE', 'Network manifest signature did not verify')
  }
  return manifest
}

function manifestPayload (manifest) {
  const { signature: _signature, ...payload } = manifest
  return payload
}

function parseManifestResponse (text, publicKey, now) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') < 2 || Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new NetworkManifestError('INVALID_RESPONSE', 'Network manifest response has an invalid size')
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new NetworkManifestError('INVALID_RESPONSE', 'Network manifest response is not valid JSON', { cause: error })
  }
  return verifyNetworkManifest(parsed, publicKey, now)
}

class NetworkManifestResolver {
  constructor ({ endpoint, publicKey, cachePath, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10_000 }) {
    if (endpoint !== undefined && endpoint !== null && typeof endpoint !== 'string') {
      throw new TypeError('Network manifest endpoint must be a string when configured')
    }
    if (!publicKey) throw new TypeError('Network manifest verification public key is required')
    if (typeof cachePath !== 'string' || !cachePath) throw new TypeError('Network manifest cache path is required')
    if (typeof fetchImpl !== 'function') throw new TypeError('Network manifest fetch implementation is required')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new TypeError('Network manifest timeout must be 1-120000 milliseconds')
    }
    this.endpoint = endpoint || null
    this.publicKey = publicKey
    this.cachePath = cachePath
    this.fetchImpl = fetchImpl
    this.now = now
    this.timeoutMs = timeoutMs
  }

  async resolve () {
    let refreshError = null
    if (this.endpoint) {
      try {
        const manifest = await this.fetchFresh()
        await this.writeCache(manifest)
        return { manifest, source: 'network', stale: false }
      } catch (error) {
        refreshError = error
      }
    } else {
      refreshError = new NetworkManifestError('ENDPOINT_UNCONFIGURED', 'The FullTime network manifest endpoint is not configured')
    }

    try {
      const manifest = await this.readCache()
      return { manifest, source: 'cache', stale: true, refreshError: describeRefreshError(refreshError) }
    } catch (cacheError) {
      throw new ConfigurationUnavailableError(
        'FullTime network configuration is unavailable. Connect to refresh the signed network configuration, then restart FullTime.',
        { cause: refreshError || cacheError }
      )
    }
  }

  async fetchFresh () {
    let endpoint
    try {
      endpoint = new URL(this.endpoint)
    } catch (error) {
      throw new NetworkManifestError('ENDPOINT_INVALID', 'The FullTime network manifest endpoint is invalid', { cause: error })
    }
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLoopback(endpoint.hostname))) {
      throw new NetworkManifestError('ENDPOINT_INVALID', 'The FullTime network manifest endpoint must use HTTPS')
    }
    if (endpoint.username || endpoint.password || endpoint.hash) {
      throw new NetworkManifestError('ENDPOINT_INVALID', 'The FullTime network manifest endpoint must not contain credentials or a fragment')
    }
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), this.timeoutMs)
    timer.unref?.()
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: abort.signal
      })
      if (!response || !response.ok) {
        throw new NetworkManifestError('FETCH_FAILED', `Network manifest request failed (${response?.status ?? 'no response'})`)
      }
      return parseManifestResponse(await response.text(), this.publicKey, this.now())
    } catch (error) {
      if (error instanceof NetworkManifestError) throw error
      throw new NetworkManifestError('FETCH_FAILED', 'Network manifest could not be fetched', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  async readCache () {
    let text
    try {
      const stat = await fs.stat(this.cachePath)
      if (!stat.isFile() || stat.size < 2 || stat.size > MAX_MANIFEST_BYTES) {
        throw new Error('cache is not a bounded regular file')
      }
      text = await fs.readFile(this.cachePath, 'utf8')
    } catch (error) {
      throw new NetworkManifestError('CACHE_UNAVAILABLE', 'No verified FullTime network configuration is cached on this device', { cause: error })
    }
    try {
      return parseManifestResponse(text, this.publicKey, this.now())
    } catch (error) {
      throw new NetworkManifestError('CACHE_INVALID', 'Cached FullTime network configuration did not verify', { cause: error })
    }
  }

  async writeCache (manifest) {
    const verified = verifyNetworkManifest(manifest, this.publicKey, this.now())
    const directory = path.dirname(this.cachePath)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = path.join(directory, `.${path.basename(this.cachePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify(verified), { mode: 0o600, flag: 'wx' })
      await fs.rename(temporary, this.cachePath)
      await fs.chmod(this.cachePath, 0o600)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }
}

function isLoopback (hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || (net.isIP(normalized) === 4 && normalized.split('.')[0] === '127')
}

function describeRefreshError (error) {
  if (error instanceof NetworkManifestError) return error.code
  return 'FETCH_FAILED'
}

module.exports = {
  ConfigurationUnavailableError,
  MAX_MANIFEST_BYTES,
  NETWORK_MANIFEST_VERSION,
  NetworkManifestError,
  NetworkManifestResolver,
  canonicalNetworkManifest,
  parseNetworkManifest,
  parseUnsignedNetworkManifest,
  signNetworkManifest,
  verifyNetworkManifest
}
