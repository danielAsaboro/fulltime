'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '../..')
const envPath = path.join(repoRoot, '.env')
const runtimeRoot = path.join(packageRoot, '.local-development')
const signingKeyPath = path.join(runtimeRoot, 'manifest-signing-key.pem')
const tlsCertificatePath = path.join(runtimeRoot, 'manifest-tls-cert.pem')
const tlsPrivateKeyPath = path.join(runtimeRoot, 'manifest-tls-key.pem')
const runtimePath = path.join(runtimeRoot, 'runtime.json')
const manifestPort = 58431
const manifestPath = '/v1/network.json'
const endpoint = `https://127.0.0.1:${manifestPort}${manifestPath}`

function main () {
  if (!fs.existsSync(envPath)) throw new Error(`Missing ${envPath}`)
  process.loadEnvFile(envPath)
  if (!process.env.TXLINE_API_TOKEN) throw new Error('TXLINE_API_TOKEN is missing from .env')
  if (!process.env.TXLINE_BASE_URL && !process.env.TXLINE_MAINNET_ORIGIN && !process.env.TXLINE_DEVNET_ORIGIN) {
    throw new Error('TXLINE_BASE_URL or a network-specific TxLINE origin is missing from .env')
  }

  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 })
  ensureManifestSigningKey()
  ensureTlsCertificate()

  const signingKey = crypto.createPrivateKey(fs.readFileSync(signingKeyPath))
  if (signingKey.asymmetricKeyType !== 'ed25519') throw new Error('Local manifest signing key must be Ed25519')
  const publicKey = crypto.createPublicKey(signingKey).export({ type: 'spki', format: 'pem' }).toString()
  writeRuntime({
    version: 2,
    kind: 'txline-live',
    pid: process.pid,
    endpoint,
    publicKey,
    caCertificatePath: tlsCertificatePath,
    startedAt: Date.now()
  })

  const env = {
    ...process.env,
    CORPUS_DIR: path.join(runtimeRoot, 'corpus'),
    FIXTURE_PLANE_DIR: path.join(runtimeRoot, 'live-fixture-plane'),
    FULLTIME_MANIFEST_SIGNING_KEY_PATH: signingKeyPath,
    FULLTIME_MANIFEST_TLS_CERT_PATH: tlsCertificatePath,
    FULLTIME_MANIFEST_TLS_KEY_PATH: tlsPrivateKeyPath,
    FULLTIME_MANIFEST_HOST: '127.0.0.1',
    FULLTIME_MANIFEST_PORT: String(manifestPort),
    FULLTIME_MANIFEST_PATH: manifestPath,
    FULLTIME_MANIFEST_PUBLIC_URL: endpoint
  }
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: packageRoot,
    env,
    stdio: 'inherit'
  })
  let closing = false
  const shutdown = (signal) => {
    if (closing) return
    closing = true
    child.kill(signal)
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  child.once('error', (error) => {
    console.error(`[fulltime local live] operator failed to start: ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    fs.rmSync(runtimePath, { force: true })
    if (!closing && (code ?? 1) !== 0) process.exitCode = code ?? 1
    if (signal) console.error(`[fulltime local live] operator exited from ${signal}`)
  })
}

function ensureManifestSigningKey () {
  if (fs.existsSync(signingKeyPath)) return
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  fs.writeFileSync(signingKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  fs.chmodSync(signingKeyPath, 0o600)
}

function ensureTlsCertificate () {
  if (certificateIsCurrent()) return
  fs.rmSync(tlsCertificatePath, { force: true })
  fs.rmSync(tlsPrivateKeyPath, { force: true })
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30',
    '-keyout', tlsPrivateKeyPath,
    '-out', tlsCertificatePath,
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1'
  ], { stdio: 'ignore' })
  if (result.status !== 0) throw new Error('Could not generate the local manifest TLS certificate with OpenSSL')
  fs.chmodSync(tlsPrivateKeyPath, 0o600)
  fs.chmodSync(tlsCertificatePath, 0o600)
}

function certificateIsCurrent () {
  if (!fs.existsSync(tlsCertificatePath) || !fs.existsSync(tlsPrivateKeyPath)) return false
  return spawnSync('openssl', ['x509', '-checkend', '86400', '-noout', '-in', tlsCertificatePath], {
    stdio: 'ignore'
  }).status === 0
}

function writeRuntime (value) {
  const temporary = `${runtimePath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, runtimePath)
    fs.chmodSync(runtimePath, 0o600)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`[fulltime local live] ${error.message}`)
  process.exitCode = 1
}
