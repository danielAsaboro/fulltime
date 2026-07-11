'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { ReleaseConfigurationError, loadDesktopReleaseConfig } = require('../lib/release-config.js')

test('release configuration contains only an HTTPS manifest endpoint and an Ed25519 verification public key', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fulltime-release-config-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const configPath = path.join(root, 'release-config.json')
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  fs.writeFileSync(configPath, JSON.stringify({
    networkManifestUrl: 'https://config.fulltime.example/v1/network.json',
    networkManifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' })
  }))

  const config = loadDesktopReleaseConfig({ configPath })
  assert.equal(config.endpoint, 'https://config.fulltime.example/v1/network.json')
  assert.equal(config.publicKey.asymmetricKeyType, 'ed25519')

  fs.writeFileSync(configPath, JSON.stringify({ networkManifestUrl: null, networkManifestPublicKey: null }))
  assert.throws(() => loadDesktopReleaseConfig({ configPath }), ReleaseConfigurationError)
})

test('loopback HTTP overrides are development-only and never a release setting', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fulltime-release-config-dev-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const configPath = path.join(root, 'release-config.json')
  const { publicKey } = crypto.generateKeyPairSync('ed25519')
  const pem = publicKey.export({ type: 'spki', format: 'pem' })
  fs.writeFileSync(configPath, JSON.stringify({ networkManifestUrl: null, networkManifestPublicKey: null }))

  const config = loadDesktopReleaseConfig({
    configPath,
    development: true,
    devEnv: {
      FULLTIME_DEV_NETWORK_MANIFEST_URL: 'http://127.0.0.1:8787/network.json',
      FULLTIME_DEV_NETWORK_MANIFEST_PUBLIC_KEY: pem
    }
  })
  assert.equal(config.endpoint, 'http://127.0.0.1:8787/network.json')
  assert.throws(() => loadDesktopReleaseConfig({
    configPath,
    development: false,
    devEnv: {
      FULLTIME_DEV_NETWORK_MANIFEST_URL: 'http://127.0.0.1:8787/network.json',
      FULLTIME_DEV_NETWORK_MANIFEST_PUBLIC_KEY: pem
    }
  }), ReleaseConfigurationError)
})
