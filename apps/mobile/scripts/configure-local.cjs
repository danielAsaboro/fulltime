'use strict'

const fs = require('fs')
const https = require('https')
const path = require('path')

const appRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const runtimePaths = [
  path.join(repoRoot, 'apps', 'worker', '.local-development', 'runtime.json'),
  path.join(repoRoot, 'apps', 'worker', '.local-development', 'replay-runtime.json')
]
const { verifyNetworkManifest } = require('../../desktop/lib/network-manifest.js')

function fetchManifest(endpoint, ca) {
  return new Promise((resolve, reject) => {
    const request = https.get(endpoint, {
      ca,
      headers: { accept: 'application/json' },
      rejectUnauthorized: true,
      timeout: 10_000
    }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > 16 * 1024) request.destroy(new Error('Local manifest response is too large'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Local manifest returned HTTP ${response.statusCode}`))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) }
      })
    })
    request.once('timeout', () => request.destroy(new Error('Local manifest request timed out')))
    request.once('error', reject)
  })
}

async function main() {
  let runtime = null
  for (const runtimePath of runtimePaths) {
    if (!fs.existsSync(runtimePath)) continue
    const candidate = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
    if (!['txline-live', 'txline-replay'].includes(candidate.kind) || !Number.isSafeInteger(candidate.pid)) continue
    try {
      process.kill(candidate.pid, 0)
      runtime = candidate
      break
    } catch (error) {
      if (error && error.code === 'EPERM') {
        runtime = candidate
        break
      }
      /* stale runtime; try the next authenticated operator */
    }
  }
  if (!runtime) throw new Error('Start the real live or archived-replay operator before building a mobile device app')
  if (typeof runtime.endpoint !== 'string' || typeof runtime.publicKey !== 'string' || typeof runtime.caCertificatePath !== 'string') {
    throw new Error('The local operator runtime does not expose a signed HTTPS manifest')
  }
  const ca = fs.readFileSync(runtime.caCertificatePath)
  const manifest = verifyNetworkManifest(await fetchManifest(runtime.endpoint, ca), runtime.publicKey)
  const relayHost = process.env.FULLTIME_MOBILE_FIXTURE_RELAY_HOST
  const relayPortText = process.env.FULLTIME_MOBILE_FIXTURE_RELAY_PORT
  if ((relayHost && !relayPortText) || (!relayHost && relayPortText)) {
    throw new Error('Local mobile fixture relay requires both FULLTIME_MOBILE_FIXTURE_RELAY_HOST and FULLTIME_MOBILE_FIXTURE_RELAY_PORT')
  }
  let fixtureRelay
  if (relayHost && relayPortText) {
    if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[A-Fa-f0-9:]+\])$/.test(relayHost)) {
      throw new Error('Local mobile fixture relay host is invalid')
    }
    const relayPort = Number.parseInt(relayPortText, 10)
    if (!Number.isSafeInteger(relayPort) || relayPort < 1 || relayPort > 65535 || String(relayPort) !== relayPortText) {
      throw new Error('Local mobile fixture relay port is invalid')
    }
    fixtureRelay = { host: relayHost, port: relayPort }
  }
  const output = path.join(appRoot, '.local-development', 'network-config.json')
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  fs.writeFileSync(output, JSON.stringify({
    endpoint: null,
    publicKey: runtime.publicKey,
    initialManifest: manifest,
    ...(fixtureRelay ? { fixtureRelay } : {})
  }, null, 2), { mode: 0o600 })
  console.log(`Wrote verified ${runtime.kind} mobile network cache for fixture feed ${manifest.fixtureFeedKey}${fixtureRelay ? ` via proof relay ${fixtureRelay.host}:${fixtureRelay.port}` : ''}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
