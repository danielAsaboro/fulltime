'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } = require('electron')

const { parseLaunchOptions } = require('../lib/config.js')
const { DesktopPeerController } = require('../lib/desktop-peer-controller.js')
const { loadOrCreateDeviceSecret } = require('./device-secret.js')
const { DesktopLocalHost } = require('../lib/local-host.js')
const { NetworkManifestResolver } = require('../lib/network-manifest.js')
const { ElectronNotificationPresenter } = require('./notification-presenter.js')
const { loadDesktopReleaseConfig } = require('../lib/release-config.js')
const { ROOM_IPC_VERSION, validateRequest } = require('../lib/room-protocol.js')
const { startDesktopWebUpstream } = require('../lib/web-upstream.js')

const EVENT_CHANNEL = 'fulltime-peers:event'
const DEFAULT_DESKTOP_LOCAL_PORT = 47831
const windows = new Set()
const rendererTrust = new WeakMap()
const securedSessions = new WeakSet()

let launchConfig
let peerController = null
let localHost = null
let quitting = false
let quitAfterCleanup = false
let closePromise = null
let notificationPresenter = null
let notificationDrain = null
let identityResetting = false

const configuredDesktopPort = Number(process.env.FULLTIME_DESKTOP_PORT || DEFAULT_DESKTOP_LOCAL_PORT)
if (!Number.isSafeInteger(configuredDesktopPort) || configuredDesktopPort < 1024 || configuredDesktopPort > 65535) {
  throw new Error('FULLTIME_DESKTOP_PORT must be an integer from 1024 through 65535')
}

const defaultStorageRoot = path.join(app.getPath('userData'), 'pear-rooms')
launchConfig = parseLaunchOptions(process.argv.slice(1), {
  storagePath: defaultStorageRoot,
  roomCode: 'room-fra-mar',
  displayName: `Peer ${process.pid}`
})
launchConfig.storagePath = path.resolve(launchConfig.storagePath)
const electronUserData = path.join(launchConfig.storagePath, 'electron')
fs.mkdirSync(electronUserData, { recursive: true, mode: 0o700 })
app.setPath('userData', electronUserData)
if (!app.requestSingleInstanceLock({ storagePath: launchConfig.storagePath })) app.exit(0)

function emitToRenderers (event) {
  for (const win of windows) {
    if (!win.isDestroyed() && isTrustedRendererUrl(win, win.webContents.getURL())) {
      win.webContents.send(EVENT_CHANNEL, event)
    }
  }
}

function createNotificationPresenter () {
  const presenter = new ElectronNotificationPresenter({
    onLifecycle: async (event) => {
      const response = await peerController.request({
        version: ROOM_IPC_VERSION,
        id: crypto.randomUUID(),
        action: 'notification.lifecycle',
        payload: {
          id: event.id,
          state: event.state,
          at: event.at,
          failure: event.failure
        }
      })
      if (!response.ok) throw new Error(response.error?.message || 'Notification lifecycle was rejected')
      void drainPendingNotifications()
    },
    getTrustedWindow: (intent) => notificationTargetWindow(intent)
  })
  presenter.on('lifecycle-error', (error, event) => {
    console.error(`[fulltime notifications] lifecycle persistence failed for ${event.id}:`, error)
  })
  return presenter
}

function notificationTargetWindow (intent) {
  const win = [...windows].find((candidate) => !candidate.isDestroyed() && isTrustedRendererUrl(candidate, candidate.webContents.getURL()))
  if (!win) return null
  const trust = rendererTrust.get(win)
  if (trust?.kind === 'origin') {
    const target = new URL(`/room/${encodeURIComponent(intent.target.roomId)}`, trust.value)
    if (intent.target.itemId) target.searchParams.set('item', intent.target.itemId)
    void win.loadURL(target.toString()).catch((error) => {
      console.error('[fulltime notifications] could not navigate to the trusted notification target:', error)
    })
  }
  return win
}

function presentQueuedNotification (intent) {
  if (!notificationPresenter || notificationPresenter.closed) return
  notificationPresenter.present(intent).catch((error) => {
    if (error?.code === 'CAPACITY') {
      void drainPendingNotifications()
      return
    }
    if (error?.code !== 'PRESENTER_CLOSED') {
      console.error('[fulltime notifications] native presentation failed:', error.message || error)
    }
  })
}

function drainPendingNotifications () {
  if (!notificationPresenter || notificationPresenter.closed || !peerController?.isStarting) return Promise.resolve()
  if (notificationDrain) return notificationDrain
  notificationDrain = (async () => {
    const response = await peerController.request({
      version: ROOM_IPC_VERSION,
      id: crypto.randomUUID(),
      action: 'notification.pending',
      payload: { limit: 64 }
    })
    if (!response.ok) throw new Error(response.error?.message || 'Pending notifications were rejected')
    if (!Array.isArray(response.result)) throw new Error('Pending notifications response is invalid')
    for (const intent of response.result) {
      if (!notificationPresenter || notificationPresenter.availableSlots < 1) break
      presentQueuedNotification(intent)
    }
  })().catch((error) => {
    if (!quitting) console.error('[fulltime notifications] could not drain durable notification intents:', error)
  }).finally(() => {
    notificationDrain = null
  })
  return notificationDrain
}

async function closeNotificationPresenter () {
  const presenter = notificationPresenter
  notificationPresenter = null
  notificationDrain = null
  await presenter?.close().catch((error) => {
    console.error('[fulltime notifications] presenter shutdown failed:', error)
  })
}

function releaseConfigPath () {
  if (!app.isPackaged) return path.resolve(__dirname, '..', 'release-config.json')
  return path.join(process.resourcesPath, 'fulltime', 'release-config.json')
}

function packagedWebRoot () {
  return path.join(process.resourcesPath, 'fulltime-web')
}

async function configurePeerController () {
  let networkResolution
  try {
    const releaseConfig = loadDesktopReleaseConfig({
      configPath: releaseConfigPath(),
      development: !app.isPackaged
    })
    peerController.setManifestVerificationKey(releaseConfig.publicKey)
    const resolver = new NetworkManifestResolver({
      endpoint: releaseConfig.endpoint,
      publicKey: releaseConfig.publicKey,
      cachePath: path.join(electronUserData, 'network-manifest-v1.json')
    })
    networkResolution = await resolver.resolve()
  } catch (error) {
    peerController.setUnavailable(error)
    console.error('[fulltime peers] signed network configuration is unavailable; local UI will remain in configuration-unavailable state', error)
    return
  }

  try {
    const deviceSecret = loadOrCreateDeviceSecret(safeStorage, electronUserData)
    try {
      await peerController.start({ deviceSecret, networkResolution })
    } finally {
      deviceSecret.fill(0)
    }
    if (networkResolution.stale) {
      console.warn(`[fulltime peers] using verified stale network configuration (${networkResolution.refreshError || 'refresh failed'})`)
    }
  } catch (error) {
    // A verified manifest existed, so retain the precise worker failure rather
    // than mislabelling it as a configuration failure or inventing a fallback.
    if (!peerController.isStarting) {
      peerController.setUnavailable(new Error(
        `FullTime could not unlock this device's protected identity. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      ))
    }
    console.error('[fulltime peers] local peer worker could not start', error)
  }
}

function isTrustedRendererUrl (win, rawUrl) {
  const trust = rendererTrust.get(win)
  if (!trust || typeof rawUrl !== 'string' || !rawUrl) return false
  try {
    const url = new URL(rawUrl)
    return trust.kind === 'origin' && url.origin === trust.value && url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' && !url.username && !url.password
  } catch {
    return false
  }
}

function isTrustedClipboardWrite (webContents, permission, requestingUrl) {
  if (permission !== 'clipboard-sanitized-write' || !webContents) return false
  const owner = BrowserWindow.fromWebContents(webContents)
  return Boolean(
    owner &&
    windows.has(owner) &&
    isTrustedRendererUrl(owner, webContents.getURL()) &&
    isTrustedRendererUrl(owner, requestingUrl)
  )
}

function secureSessionPermissions (electronSession) {
  if (securedSessions.has(electronSession)) return
  electronSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const requestingUrl = details?.requestingUrl || requestingOrigin
    return isTrustedClipboardWrite(webContents, permission, requestingUrl)
  })
  electronSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents.getURL()
    callback(isTrustedClipboardWrite(webContents, permission, requestingUrl))
  })
  securedSessions.add(electronSession)
}

function guardNavigation (win, event, legacyTarget) {
  const target = typeof event.url === 'string' ? event.url : legacyTarget
  if (isTrustedRendererUrl(win, target)) return
  event.preventDefault()
  console.warn(`[fulltime peers] blocked renderer navigation to ${String(target)}`)
}

function isPearDocsUrl (rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.origin === 'https://docs.pears.com' && !url.username && !url.password
  } catch {
    return false
  }
}

async function loadRenderer (win) {
  if (!localHost?.url) throw new Error('Desktop local host is unavailable')
  rendererTrust.set(win, { kind: 'origin', value: localHost.url })
  await win.loadURL(new URL('/app', localHost.url).toString())
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#f4f1ec',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  })
  windows.add(win)
  secureSessionPermissions(win.webContents.session)
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isPearDocsUrl(url)) {
      void shell.openExternal(url).catch((error) => {
        console.error('[fulltime peers] could not open Pear documentation', error)
      })
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, target) => guardNavigation(win, event, target))
  win.webContents.on('will-redirect', (event, target) => guardNavigation(win, event, target))
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('did-finish-load', () => {
    if (!isTrustedRendererUrl(win, win.webContents.getURL())) return
    for (const event of peerController?.cachedState() || []) win.webContents.send(EVENT_CHANNEL, event)
  })
  win.on('closed', () => windows.delete(win))
  void loadRenderer(win).catch((error) => {
    console.error('[fulltime peers] renderer startup failed', error)
    if (!win.isDestroyed()) win.destroy()
    app.quit()
  })
  return win
}

function installIpcHandlers () {
  function assertTrustedRenderer (event) {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const frameUrl = event.senderFrame && event.senderFrame.url
    if (
      !owner ||
      !windows.has(owner) ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedRendererUrl(owner, frameUrl) ||
      !isTrustedRendererUrl(owner, event.sender.getURL())
    ) {
      throw new Error('Untrusted renderer')
    }
  }

  ipcMain.handle('fulltime-peers:get-config', (event) => {
    assertTrustedRenderer(event)
    try {
      return { ok: true, result: peerController.bridgeConfig() }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'CONFIGURATION_UNAVAILABLE',
          message: error instanceof Error && error.message
            ? error.message
            : 'FullTime network configuration is unavailable.'
        }
      }
    }
  })
  ipcMain.handle('fulltime-peers:request', async (event, input) => {
    assertTrustedRenderer(event)
    return peerController.request(validateRequest(input))
  })
  ipcMain.handle('fulltime-peers:reset-identity', async (event) => {
    assertTrustedRenderer(event)
    if (identityResetting) throw new Error('Device identity reset is already in progress')
    identityResetting = true
    await closeRuntime()
    const archivePath = `${launchConfig.storagePath}.identity-archive-${new Date().toISOString().replace(/[:.]/g, '-')}`
    fs.renameSync(launchConfig.storagePath, archivePath)
    console.warn(`[fulltime peers] archived the inaccessible device identity at ${archivePath}`)
    app.relaunch({ args: process.argv.slice(1) })
    quitAfterCleanup = true
    setImmediate(() => app.quit())
    return { ok: true }
  })
}

function installApplicationMenu () {
  const template = [{
    label: 'FullTime',
    submenu: [
      {
        label: 'Open in browser',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => {
          void localHost?.openInBrowser().catch((error) => {
            console.error('[fulltime peers] could not open the local browser session', error)
          })
        }
      },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function closeRuntime () {
  if (closePromise) return closePromise
  closePromise = (async () => {
    // Closing the local host first invalidates every browser cookie/session
    // before the Electron process can leave its desktop identity behind.
    await localHost?.close().catch((error) => console.error('[fulltime peers] local host shutdown failed', error))
    await closeNotificationPresenter()
    await peerController?.close().catch((error) => console.error('[fulltime peers] peer worker shutdown failed', error))
  })()
  return closePromise
}

app.whenReady().then(async () => {
  peerController = new DesktopPeerController({
    storagePath: launchConfig.storagePath,
    displayName: launchConfig.displayName
  })
  peerController.on('event', (event) => {
    if (event.type === 'bridge.ready') void drainPendingNotifications()
    emitToRenderers(event)
  })
  peerController.on('notification', presentQueuedNotification)
  notificationPresenter = createNotificationPresenter()

  await configurePeerController()
  localHost = new DesktopLocalHost({
    peerController,
    // Privy authorizes exact web origins. A stable loopback port lets the
    // desktop renderer be allowlisted without granting a wildcard origin.
    port: configuredDesktopPort,
    openExternal: (url) => shell.openExternal(url),
    startUpstream: () => startDesktopWebUpstream({
      mode: app.isPackaged ? 'packaged' : 'development',
      packagedRoot: app.isPackaged ? packagedWebRoot() : undefined
    })
  })
  await localHost.start()
  installIpcHandlers()
  installApplicationMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error) => {
  console.error('[fulltime peers] startup failed', error)
  app.quit()
})

app.on('before-quit', (event) => {
  if (quitAfterCleanup) return
  event.preventDefault()
  quitting = true
  void closeRuntime().finally(() => {
    quitAfterCleanup = true
    app.quit()
  })
})

app.on('will-quit', () => {
  ipcMain.removeHandler('fulltime-peers:get-config')
  ipcMain.removeHandler('fulltime-peers:request')
  ipcMain.removeHandler('fulltime-peers:reset-identity')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
