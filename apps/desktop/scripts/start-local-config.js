'use strict'

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const { parseEnv } = require('util')

const { verifyNetworkManifest } = require('../lib/network-manifest.js')

const electronPath = require('electron')
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '../..')
const repoEnvPath = path.join(repoRoot, '.env')
const runtimePath = path.resolve(desktopRoot, '../worker/.local-development/runtime.json')
const storagePath = path.join(desktopRoot, '.local-development', 'peer-store')
const logPath = path.join(desktopRoot, '.local-development', 'electron.log')
const pidPath = path.join(desktopRoot, '.local-development', 'electron.pid')

async function main () {
  const runtime = readRuntime()
  assertOperatorAlive(runtime.pid)
  const endpoint = validateEndpoint(runtime)
  validatePublicKey(runtime.publicKey)
  await waitForManifest(endpoint, runtime)
  await stopExistingDesktop()

  fs.mkdirSync(storagePath, { recursive: true, mode: 0o700 })
  const logFd = fs.openSync(logPath, 'a', 0o600)
  const env = {
    ...process.env,
    ...loadPublicEnvironment(),
    FULLTIME_DEV_NETWORK_MANIFEST_URL: endpoint,
    FULLTIME_DEV_NETWORK_MANIFEST_PUBLIC_KEY: runtime.publicKey
  }
  for (const key of Object.keys(env)) {
    if (/^(?:TXLINE_|ACTIVATION_|FULLTIME_MANIFEST_)/.test(key)) delete env[key]
  }
  if (runtime.caCertificatePath) env.NODE_EXTRA_CA_CERTS = runtime.caCertificatePath
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(electronPath, [
    desktopRoot,
    '--storage', storagePath,
    '--name', 'Local FullTime'
  ], {
    cwd: desktopRoot,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  })
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
  } finally {
    fs.closeSync(logFd)
  }
  child.unref()
  fs.writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 })
  console.log(`[fulltime desktop] started local development app (pid ${child.pid}); log: ${logPath}`)
}

async function stopExistingDesktop () {
  let pid
  try { pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10) } catch { return }
  if (!Number.isSafeInteger(pid) || pid < 1) {
    fs.rmSync(pidPath, { force: true })
    return
  }
  let command = ''
  try { command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim() } catch {
    fs.rmSync(pidPath, { force: true })
    await waitForStorageRelease()
    return
  }
  if (!command.includes(desktopRoot) || !command.includes(`--storage ${storagePath}`)) {
    throw new Error(`Refusing to stop unrelated process recorded in ${pidPath}`)
  }
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) } catch {
      fs.rmSync(pidPath, { force: true })
      await waitForStorageRelease()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Existing FullTime desktop process ${pid} did not shut down cleanly; no second instance was started`)
}

async function waitForStorageRelease () {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const owners = findStorageOwners()
    if (owners.length === 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const owners = findStorageOwners()
  throw new Error(`FullTime peer storage is still owned by process ${owners.join(', ')}; no second instance was started`)
}

function findStorageOwners () {
  let output = ''
  try { output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }) } catch { return [] }
  const storageArgument = `--storage ${storagePath}`
  return output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match || !match[2].includes(desktopRoot) || !match[2].includes(storageArgument)) return []
    const owner = Number.parseInt(match[1], 10)
    return Number.isSafeInteger(owner) && owner !== process.pid ? [owner] : []
  })
}

function loadPublicEnvironment () {
  if (!fs.existsSync(repoEnvPath)) return {}
  const parsed = parseEnv(fs.readFileSync(repoEnvPath, 'utf8'))
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => key.startsWith('NEXT_PUBLIC_')))
}

function readRuntime () {
  let value
  try {
    value = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  } catch (error) {
    throw new Error('Local operator authority is not running; start npm run operator:local-config first', { cause: error })
  }
  const allowed = ['version', 'kind', 'pid', 'endpoint', 'publicKey', 'fixtureFeedKey', 'caCertificatePath', 'startedAt']
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key)) || ![1, 2].includes(value.version) ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      typeof value.endpoint !== 'string' || typeof value.publicKey !== 'string' ||
      !Number.isSafeInteger(value.startedAt) || value.startedAt < 0) {
    throw new Error('Local operator runtime configuration is invalid')
  }
  if (value.version === 1 && (typeof value.fixtureFeedKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.fixtureFeedKey))) {
    throw new Error('Local operator runtime fixture feed key is invalid')
  }
  if (value.version === 2 && (value.kind !== 'txline-live' || typeof value.caCertificatePath !== 'string' || !path.isAbsolute(value.caCertificatePath))) {
    throw new Error('Local live operator runtime configuration is invalid')
  }
  return value
}

function assertOperatorAlive (pid) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    throw new Error('Local operator authority is not running; restart npm run operator:local-config', { cause: error })
  }
}

function validateEndpoint (runtime) {
  let endpoint
  try {
    endpoint = new URL(runtime.endpoint)
  } catch (error) {
    throw new Error('Local operator manifest endpoint is invalid', { cause: error })
  }
  const expectedProtocol = runtime.version === 2 ? 'https:' : 'http:'
  if (endpoint.protocol !== expectedProtocol || endpoint.hostname !== '127.0.0.1' ||
      endpoint.username || endpoint.password || endpoint.hash || endpoint.pathname !== '/v1/network.json') {
    throw new Error('Local operator manifest endpoint must be the exact loopback development endpoint')
  }
  return endpoint.toString()
}

function validatePublicKey (value) {
  let key
  try {
    key = crypto.createPublicKey(value)
  } catch (error) {
    throw new Error('Local operator manifest public key is invalid', { cause: error })
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Local operator manifest key must be Ed25519')
}

async function waitForManifest (endpoint, runtime) {
  const deadline = Date.now() + 45_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const manifest = await fetchManifest(endpoint, runtime.caCertificatePath)
      verifyNetworkManifest(manifest, runtime.publicKey)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error('Local operator manifest did not become ready', { cause: lastError })
}

function fetchManifest (endpoint, caCertificatePath) {
  const url = new URL(endpoint)
  const transport = url.protocol === 'https:' ? https : http
  const options = caCertificatePath
    ? { ca: fs.readFileSync(caCertificatePath), rejectUnauthorized: true }
    : undefined
  return new Promise((resolve, reject) => {
    const request = transport.get(url, options, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.once('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Local manifest returned HTTP ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.once('error', reject)
    request.setTimeout(2_000, () => request.destroy(new Error('Local manifest request timed out')))
  })
}

void main().catch((error) => {
  console.error(`[fulltime desktop] ${error.message}`)
  process.exitCode = 1
})
