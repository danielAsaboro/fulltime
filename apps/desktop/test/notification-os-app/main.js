'use strict'

const assert = require('node:assert/strict')
const { app } = require('electron')

const { ElectronNotificationPresenter } = require('../../electron/notification-presenter.js')

const GATE = 'FULLTIME_RUN_OS_NOTIFICATION_INTEGRATION'
const HARD_TIMEOUT_MS = 25_000

if (process.env[GATE] !== '1') {
  console.error(
    `${GATE}=1 is required because this test displays a real desktop notification and requires an interactive OS notification service and permission.`
  )
  app.exit(2)
} else {
  const watchdog = setTimeout(() => {
    console.error('OS notification integration timed out without a real Electron Notification show event.')
    app.exit(1)
  }, HARD_TIMEOUT_MS)

  app.setName('FullTime Notification Integration')
  app.whenReady().then(async () => {
    const lifecycle = []
    const presenter = new ElectronNotificationPresenter({
      onLifecycle: async (event) => {
        if (event.state === 'presented') await new Promise((resolve) => setTimeout(resolve, 25))
        lifecycle.push(event)
      },
      // The integration verifies native presentation. Click focus is wired by
      // production main.js to its existing trusted-window resolver.
      getTrustedWindow: () => null,
      maxActive: 1,
      showTimeoutMs: 15_000,
      maxLifetimeMs: 60_000
    })
    try {
      const intent = {
        version: 1,
        id: `notification-os-${process.pid}`,
        sourceId: `notification-source-${process.pid}`,
        roomId: 'room-notification-integration',
        category: 'message',
        title: 'FullTime notification integration',
        body: 'This is a real Electron OS notification presentation check.',
        target: { roomId: 'room-notification-integration', itemId: null },
        createdAt: Date.now(),
        state: 'queued',
        presentedAt: null,
        resolvedAt: null,
        failure: null
      }
      const firstPresentation = presenter.present(intent)
      assert.equal(presenter.present(intent), firstPresentation, 'active durable IDs must deduplicate')
      await assert.rejects(presenter.present({
        ...intent,
        id: `notification-capacity-${process.pid}`,
        sourceId: `notification-capacity-source-${process.pid}`
      }), { code: 'CAPACITY' })
      const presented = await firstPresentation
      assert.equal(presented.state, 'presented')
      await presenter.close()
      assert.deepEqual(lifecycle.map((event) => event.state), ['presented', 'dismissed'])
      assert.deepEqual(lifecycle[0], presented)
      console.log('PASS: Electron emitted a real native Notification show event before presentation succeeded.')
      clearTimeout(watchdog)
      app.exit(0)
    } catch (error) {
      await presenter.close().catch(() => {})
      clearTimeout(watchdog)
      console.error('FAIL: real OS notification presentation did not complete:', error)
      app.exit(1)
    }
  }).catch((error) => {
    clearTimeout(watchdog)
    console.error('FAIL: Electron notification integration could not start:', error)
    app.exit(1)
  })
}
