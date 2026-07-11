'use strict'

const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const path = require('path')

class ReleaseConfigurationError extends Error {
  constructor (message, options = undefined) {
    super(message, options)
    this.name = 'ReleaseConfigurationError'
    this.code = 'CONFIGURATION_UNAVAILABLE'
  }
}

function loadDesktopReleaseConfig ({ configPath = path.resolve(__dirname, '..', 'release-config.json'), devEnv = process.env, development = false } = {}) {
  let value
  try {
    value = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new ReleaseConfigurationError('This FullTime build has no embedded network configuration.', { cause: error })
  }
  if (!isPlainObject(value) || Object.keys(value).some((key) => !['networkManifestUrl', 'networkManifestPublicKey'].includes(key))) {
    throw new ReleaseConfigurationError('This FullTime build has an invalid embedded network configuration.')
  }
  const configuredUrl = development && typeof devEnv.FULLTIME_DEV_NETWORK_MANIFEST_URL === 'string'
    ? devEnv.FULLTIME_DEV_NETWORK_MANIFEST_URL
    : value.networkManifestUrl
  const configuredPublicKey = development && typeof devEnv.FULLTIME_DEV_NETWORK_MANIFEST_PUBLIC_KEY === 'string'
    ? devEnv.FULLTIME_DEV_NETWORK_MANIFEST_PUBLIC_KEY
    : value.networkManifestPublicKey
  if (typeof configuredUrl !== 'string' || !configuredUrl || typeof configuredPublicKey !== 'string' || !configuredPublicKey) {
    throw new ReleaseConfigurationError('This FullTime build has no embedded signed-network manifest endpoint or verification key.')
  }
  const endpoint = parseManifestEndpoint(configuredUrl, development)
  const publicKey = parseVerificationKey(configuredPublicKey)
  return { endpoint: endpoint.toString(), publicKey }
}

function parseManifestEndpoint (value, development) {
  let endpoint
  try {
    endpoint = new URL(value)
  } catch (error) {
    throw new ReleaseConfigurationError('The embedded FullTime network manifest endpoint is invalid.', { cause: error })
  }
  if (endpoint.username || endpoint.password || endpoint.hash ||
      (endpoint.protocol !== 'https:' && !(development && endpoint.protocol === 'http:' && isLoopbackHostname(endpoint.hostname)))) {
    throw new ReleaseConfigurationError('The embedded FullTime network manifest endpoint must use HTTPS.')
  }
  return endpoint
}

function parseVerificationKey (value) {
  let key
  try {
    key = crypto.createPublicKey(value)
  } catch (error) {
    throw new ReleaseConfigurationError('The embedded FullTime network manifest verification key is invalid.', { cause: error })
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new ReleaseConfigurationError('The embedded FullTime network manifest verification key must be Ed25519.')
  }
  return key
}

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isLoopbackHostname (hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1' || (net.isIP(normalized) === 4 && normalized.split('.')[0] === '127')
}

module.exports = {
  ReleaseConfigurationError,
  loadDesktopReleaseConfig,
  parseManifestEndpoint,
  parseVerificationKey
}
