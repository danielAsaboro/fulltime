'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createUpstreamEnvironment } = require('../lib/web-upstream.js')

test('private standalone upstream runs an Electron executable in Node mode', () => {
  const base = { PATH: '/usr/bin', KEEP: 'value' }
  const child = createUpstreamEnvironment({
    env: base,
    port: 43121,
    upstreamToken: 'private-token',
    electronRuntime: true
  })

  assert.equal(child.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(child.HOSTNAME, '127.0.0.1')
  assert.equal(child.PORT, '43121')
  assert.equal(child.FULLTIME_LOCAL_UPSTREAM_TOKEN, 'private-token')
  assert.equal(child.KEEP, 'value')
  assert.equal(base.ELECTRON_RUN_AS_NODE, undefined)
})

test('plain Node upstream leaves Electron mode unset', () => {
  const child = createUpstreamEnvironment({
    env: { PATH: '/usr/bin' },
    port: 43121,
    upstreamToken: 'private-token',
    electronRuntime: false
  })

  assert.equal(child.ELECTRON_RUN_AS_NODE, undefined)
})
