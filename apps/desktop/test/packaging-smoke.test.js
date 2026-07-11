'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { DesktopPeerController } = require('../lib/desktop-peer-controller.js')
const { DesktopLocalHost } = require('../lib/local-host.js')
const { findStandaloneServer, startDesktopWebUpstream } = require('../lib/web-upstream.js')

const enabled = process.env.FULLTIME_RUN_PACKAGING_SMOKE === '1'
const packagedRoot = process.env.FULLTIME_PACKAGED_WEB_ROOT

test('bundled standalone UI serves Electron-hosted and normal-browser loopback paths without preload or TxLINE credentials', {
  skip: enabled && packagedRoot ? false : 'set FULLTIME_RUN_PACKAGING_SMOKE=1 and FULLTIME_PACKAGED_WEB_ROOT to the bundled fulltime-web resource',
  timeout: 90_000
}, async () => {
  const root = path.resolve(packagedRoot)
  assert.equal(fs.existsSync(findStandaloneServer(root)), true)
  assert.equal(fs.existsSync(path.join(root, '..', 'fulltime', 'release-config.json')), true)

  const upstream = await startDesktopWebUpstream({ mode: 'packaged', packagedRoot: root })
  const controller = new DesktopPeerController({
    storagePath: path.join(root, '.smoke-peer-store'),
    displayName: 'Packaging smoke'
  })
  controller.setUnavailable(new Error('Packaging smoke intentionally has no deployed manifest'))
  const host = new DesktopLocalHost({ peerController: controller, upstream: upstream.url })
  try {
    const url = await host.start()
    const ui = await fetch(`${url}/`)
    assert.equal(ui.status, 200)
    assert.match(await ui.text(), /FullTime/i)

    const capability = host.issueBrowserCapabilityUrl()
    const admitted = await fetch(capability, { redirect: 'manual' })
    const cookie = admitted.headers.get('set-cookie').split(';', 1)[0]
    const config = await fetch(`${url}/api/peer/config`, { headers: { origin: url, cookie } })
    assert.equal(config.status, 503)
    assert.equal((await config.json()).error.code, 'CONFIGURATION_UNAVAILABLE')
  } finally {
    await host.close().catch(() => {})
    await controller.close().catch(() => {})
    await upstream.close().catch(() => {})
  }
})
