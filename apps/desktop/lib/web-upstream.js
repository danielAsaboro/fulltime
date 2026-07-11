'use strict'

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')

const STARTUP_TIMEOUT_MS = 60_000

/** Starts Next privately; callers expose it only through DesktopLocalHost. */
async function startDesktopWebUpstream ({
  mode = 'development',
  webRoot = path.resolve(__dirname, '../../web'),
  packagedRoot = undefined,
  env = process.env,
  spawnImpl = spawn,
  startupTimeoutMs = STARTUP_TIMEOUT_MS
} = {}) {
  if (mode !== 'development' && mode !== 'packaged') throw new TypeError('Desktop web upstream mode must be development or packaged')
  if (typeof webRoot !== 'string' || !path.isAbsolute(webRoot)) throw new TypeError('Desktop web root must be an absolute path')
  if (typeof spawnImpl !== 'function') throw new TypeError('Desktop web upstream spawn implementation is required')
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1_000 || startupTimeoutMs > 120_000) {
    throw new TypeError('Desktop web upstream startup timeout must be 1000-120000 milliseconds')
  }

  const port = await reserveLoopbackPort()
  const upstreamToken = crypto.randomBytes(32).toString('base64url')
  const childEnv = createUpstreamEnvironment({
    env,
    port,
    upstreamToken,
    electronRuntime: Boolean(process.versions.electron)
  })
  let command
  let args
  let cwd
  if (mode === 'development') {
    command = process.execPath
    args = [require.resolve('next/dist/bin/next', { paths: [webRoot] }), 'dev', '-H', '127.0.0.1', '-p', String(port)]
    cwd = webRoot
  } else {
    const server = findStandaloneServer(packagedRoot, webRoot)
    command = process.execPath
    args = [server]
    cwd = path.dirname(server)
  }

  const child = spawnImpl(command, args, {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = []
  const remember = (chunk) => {
    output.push(String(chunk))
    if (output.length > 16) output.shift()
  }
  child.stdout?.on('data', remember)
  child.stderr?.on('data', remember)
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/local-host-ready`, child, startupTimeoutMs, upstreamToken)
  } catch (error) {
    await stopChild(child)
    const diagnostics = output.join('').trim().slice(-2_048)
    throw new Error(`Private FullTime web renderer did not start${diagnostics ? `: ${diagnostics}` : ''}`, { cause: error })
  }
  return {
    url: `http://127.0.0.1:${port}`,
    async close () {
      await stopChild(child)
    }
  }
}

function createUpstreamEnvironment ({ env, port, upstreamToken, electronRuntime }) {
  const childEnv = {
    ...env,
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
    FULLTIME_LOCAL_UPSTREAM_TOKEN: upstreamToken
  }
  // In Electron, process.execPath is the Electron application executable, not
  // plain Node. Run that executable in Node mode for the private Next child so
  // it executes server.js instead of recursively launching the desktop app.
  if (electronRuntime) childEnv.ELECTRON_RUN_AS_NODE = '1'
  return childEnv
}

function findStandaloneServer (packagedRoot, webRoot = path.resolve(__dirname, '../../web')) {
  const candidates = [
    packagedRoot && path.resolve(packagedRoot, 'server.js'),
    packagedRoot && path.resolve(packagedRoot, 'apps/web/server.js'),
    path.resolve(webRoot, '.next/standalone/server.js'),
    path.resolve(webRoot, '.next/standalone/apps/web/server.js')
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  throw new Error('Bundled FullTime web standalone output is missing; run the desktop packaging build')
}

function reserveLoopbackPort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
        server.close(() => reject(new Error('Could not reserve an IPv4 loopback port')))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function waitForHttp (url, child, timeoutMs, token) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    let settled = false
    let retryTimer = null
    const finish = (error = null) => {
      if (settled) return
      settled = true
      if (retryTimer) clearTimeout(retryTimer)
      child.removeListener('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    const onExit = (code, signal) => finish(new Error(`Private web renderer exited before becoming ready (${code ?? signal ?? 'unknown'})`))
    const probe = () => {
      if (Date.now() >= deadline) {
        finish(new Error('Timed out waiting for private web renderer'))
        return
      }
      const request = http.get(url, { headers: { 'x-fulltime-upstream-token': token } }, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.once('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          let ready = false
          try {
            ready = response.statusCode === 200 && JSON.parse(body)?.ok === true
          } catch {}
          if (ready) finish()
          else {
            retryTimer = setTimeout(probe, 100)
            retryTimer.unref?.()
          }
        })
      })
      request.once('error', () => {
        retryTimer = setTimeout(probe, 100)
        retryTimer.unref?.()
      })
      request.setTimeout(1_000, () => request.destroy())
    }
    child.once('exit', onExit)
    probe()
  })
}

function stopChild (child) {
  if (!child ||
      (child.exitCode !== null && child.exitCode !== undefined) ||
      (child.signalCode !== null && child.signalCode !== undefined)) return Promise.resolve()
  return new Promise((resolve) => {
    let killTimer = null
    const finish = () => {
      if (killTimer) clearTimeout(killTimer)
      resolve()
    }
    child.once('exit', finish)
    try {
      child.kill('SIGTERM')
    } catch {
      finish()
      return
    }
    killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
    }, 8_000)
    killTimer.unref?.()
  })
}

module.exports = {
  STARTUP_TIMEOUT_MS,
  createUpstreamEnvironment,
  findStandaloneServer,
  startDesktopWebUpstream
}
