'use strict'

const fs = require('fs')
const https = require('https')
const path = require('path')

const appRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const runtimePath = path.join(repoRoot, 'apps', 'worker', '.local-development', 'runtime.json')
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
  if (!fs.existsSync(runtimePath)) throw new Error('Start the real operator first with npm run operator:local-live')
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
  if (runtime.kind !== 'txline-live' || !Number.isSafeInteger(runtime.pid)) {
    throw new Error('Mobile device builds require the real TxLINE live operator runtime')
  }
  try { process.kill(runtime.pid, 0) } catch { throw new Error('The recorded local operator process is not running') }
  if (typeof runtime.endpoint !== 'string' || typeof runtime.publicKey !== 'string' || typeof runtime.caCertificatePath !== 'string') {
    throw new Error('The local operator runtime does not expose a signed HTTPS manifest')
  }
  const ca = fs.readFileSync(runtime.caCertificatePath)
  const manifest = verifyNetworkManifest(await fetchManifest(runtime.endpoint, ca), runtime.publicKey)
  const output = path.join(appRoot, '.local-development', 'network-config.json')
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  fs.writeFileSync(output, JSON.stringify({
    endpoint: null,
    publicKey: runtime.publicKey,
    initialManifest: manifest
  }, null, 2), { mode: 0o600 })
  console.log(`Wrote verified mobile network cache for fixture feed ${manifest.fixtureFeedKey}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
