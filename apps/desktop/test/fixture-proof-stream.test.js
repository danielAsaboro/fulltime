'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const b4a = require('b4a')
const Corestore = require('corestore')

const {
  decodeFixtureProof,
  decodeFixtureProofRequest,
  encodeFixtureProof,
  encodeFixtureProofRequest,
  frameFixtureProof
} = require('../lib/fixture-proof-stream.js')

test('serialized publisher proofs populate a fresh pinned Hypercore without trusting the relay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fulltime-fixture-proof-'))
  const sourceStore = new Corestore(path.join(root, 'source'))
  const targetStore = new Corestore(path.join(root, 'target'))
  try {
    await Promise.all([sourceStore.ready(), targetStore.ready()])
    const source = sourceStore.get({ name: 'publisher' })
    await source.ready()
    await source.append(['first', 'second', 'third'])
    const target = targetStore.get({ key: source.key })
    await target.ready()

    for (let index = 0; index < source.length; index++) {
      const options = index === 0
        ? { block: { index, nodes: 0 }, upgrade: { start: 0, length: source.length } }
        : { block: { index, nodes: 0 } }
      const proof = await source.proof(options)
      proof.block.value = await source.get(index)
      proof.manifest = source.core.header.manifest
      const encoded = encodeFixtureProof({ index, proof })
      const decoded = decodeFixtureProof(encoded)
      assert.equal(decoded.index, index)
      assert.equal(await target.applyProof(decoded.proof), true)
      assert.equal(b4a.toString(await target.get(index, { wait: false })), b4a.toString(await source.get(index)))
    }

    assert.equal(target.length, source.length)
    assert.equal(target.contiguousLength, source.length)
  } finally {
    await Promise.all([sourceStore.close().catch(() => {}), targetStore.close().catch(() => {})])
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('fixture proof stream framing and resume requests are closed and bounded', () => {
  const request = encodeFixtureProofRequest({ length: 9, start: 4 })
  assert.deepEqual(decodeFixtureProofRequest(request.subarray(0, request.byteLength - 1)), { length: 9, start: 4 })
  assert.throws(() => decodeFixtureProofRequest(b4a.from('{"version":1,"length":9,"start":10}')), /invalid/)
  assert.throws(() => decodeFixtureProof(b4a.from('{}')), /version is unsupported/)
  assert.throws(() => frameFixtureProof(b4a.alloc(256 * 1024 + 1)), /invalid size/)
})
