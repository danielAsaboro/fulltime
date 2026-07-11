'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const { decodeWorkerBootstrap, encodeWorkerBootstrap } = require('../lib/worker-bootstrap.js')

test('device secret crosses the private Pear IPC bootstrap frame without entering launch arguments', () => {
  const secret = crypto.randomBytes(32)
  const encoded = encodeWorkerBootstrap(secret)
  assert.deepEqual(decodeWorkerBootstrap(encoded).deviceSecret, secret)
  assert.equal(b4a.toString(encoded).includes('account-secret'), false)

  const injected = JSON.parse(b4a.toString(encoded))
  injected.extra = true
  assert.throws(() => decodeWorkerBootstrap(b4a.from(JSON.stringify(injected))), /invalid/)
})
