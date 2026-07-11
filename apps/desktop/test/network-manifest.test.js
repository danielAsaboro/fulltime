'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  ConfigurationUnavailableError,
  NetworkManifestResolver,
  canonicalNetworkManifest,
  signNetworkManifest,
  verifyNetworkManifest
} = require('../lib/network-manifest.js')

const NOW = 1_800_000_000_000

function createKeys () {
  return crypto.generateKeyPairSync('ed25519')
}

function unsignedManifest () {
  return {
    version: 1,
    issuedAt: NOW,
    fixtureFeedKey: 'ab'.repeat(32),
    answerAttestor: {
      servicePublicKey: 'cd'.repeat(32),
      receiptFeedKey: 'ef'.repeat(32)
    }
  }
}

test('network manifests use canonical Ed25519 signatures and exact pins', () => {
  const { privateKey, publicKey } = createKeys()
  const signed = signNetworkManifest(unsignedManifest(), privateKey, NOW)
  const verified = verifyNetworkManifest(signed, publicKey, NOW)

  assert.equal(canonicalNetworkManifest(unsignedManifest(), NOW), canonicalNetworkManifest({
    fixtureFeedKey: 'ab'.repeat(32),
    issuedAt: NOW,
    answerAttestor: { receiptFeedKey: 'ef'.repeat(32), servicePublicKey: 'cd'.repeat(32) },
    version: 1
  }, NOW))
  assert.equal(verified.fixtureFeedKey, 'ab'.repeat(32))
  assert.deepEqual(verified.answerAttestor, {
    servicePublicKey: 'cd'.repeat(32),
    receiptFeedKey: 'ef'.repeat(32)
  })
})

test('network manifest verification rejects changed bytes and invalid schemas', () => {
  const { privateKey, publicKey } = createKeys()
  const signed = signNetworkManifest(unsignedManifest(), privateKey, NOW)
  assert.throws(
    () => verifyNetworkManifest({ ...signed, fixtureFeedKey: '12'.repeat(32) }, publicKey, NOW),
    /did not verify/
  )
  assert.throws(
    () => verifyNetworkManifest({ ...signed, extra: true }, publicKey, NOW),
    /schema/
  )
})

test('network manifest resolver caches a fresh verified response and uses it only after refresh fails', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-network-manifest-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { privateKey, publicKey } = createKeys()
  const signed = signNetworkManifest(unsignedManifest(), privateKey, NOW)
  const cachePath = path.join(root, 'manifest.json')

  const fresh = new NetworkManifestResolver({
    endpoint: 'http://127.0.0.1:9999/network.json',
    publicKey,
    cachePath,
    now: () => NOW,
    fetchImpl: async () => new Response(JSON.stringify(signed), { status: 200 })
  })
  const resolved = await fresh.resolve()
  assert.equal(resolved.source, 'network')
  assert.equal(resolved.stale, false)
  assert.equal((await fs.stat(cachePath)).mode & 0o077, 0)

  const offline = new NetworkManifestResolver({
    endpoint: 'http://127.0.0.1:9999/network.json',
    publicKey,
    cachePath,
    now: () => NOW,
    fetchImpl: async () => { throw new Error('offline') }
  })
  const cached = await offline.resolve()
  assert.equal(cached.source, 'cache')
  assert.equal(cached.stale, true)
  assert.equal(cached.refreshError, 'FETCH_FAILED')
  assert.equal(cached.manifest.fixtureFeedKey, signed.fixtureFeedKey)
})

test('network manifest resolver never starts from an unverified cache', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-network-manifest-no-cache-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { privateKey, publicKey } = createKeys()
  const signed = signNetworkManifest(unsignedManifest(), privateKey, NOW)
  const cachePath = path.join(root, 'manifest.json')
  const alteredSignature = (signed.signature[0] === 'A' ? 'B' : 'A') + signed.signature.slice(1)
  await fs.writeFile(cachePath, JSON.stringify({ ...signed, signature: alteredSignature }))

  const resolver = new NetworkManifestResolver({
    endpoint: 'http://127.0.0.1:9999/network.json',
    publicKey,
    cachePath,
    now: () => NOW,
    fetchImpl: async () => { throw new Error('offline') }
  })
  await assert.rejects(resolver.resolve(), ConfigurationUnavailableError)
})
