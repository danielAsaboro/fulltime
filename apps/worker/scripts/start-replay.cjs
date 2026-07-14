'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '../..')
const workspaceRoot = path.resolve(repoRoot, '..')
const runtimeRoot = path.join(packageRoot, '.local-development')
const signingKeyPath = path.join(runtimeRoot, 'manifest-signing-key.pem')
const tlsCertificatePath = path.join(runtimeRoot, 'manifest-tls-cert.pem')
const tlsPrivateKeyPath = path.join(runtimeRoot, 'manifest-tls-key.pem')
const runtimePath = path.join(runtimeRoot, 'replay-runtime.json')
const session = new Date().toISOString().replace(/[:.]/g, '-')

function ensureAuthority () {
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(signingKeyPath)) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(signingKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  }
  const certificateCurrent = fs.existsSync(tlsCertificatePath) && fs.existsSync(tlsPrivateKeyPath) && spawnSync('openssl', ['x509', '-checkend', '86400', '-noout', '-in', tlsCertificatePath]).status === 0
  if (!certificateCurrent) {
    fs.rmSync(tlsCertificatePath, { force: true })
    fs.rmSync(tlsPrivateKeyPath, { force: true })
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30', '-keyout', tlsPrivateKeyPath, '-out', tlsCertificatePath, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
    if (result.status !== 0) throw new Error('Could not generate the local replay TLS certificate')
  }
}

ensureAuthority()
const env = {
  ...process.env,
  FULLTIME_REPLAY_ARCHIVE_DIR: path.join(workspaceRoot, 'resources/fixtures/world-cup-2026/18213979-norway-vs-england'),
  FULLTIME_REPLAY_FIXTURE_PLANE_DIR: path.join(runtimeRoot, 'replay-fixture-plane', session),
  FULLTIME_REPLAY_RUNTIME_PATH: runtimePath,
  FULLTIME_MANIFEST_SIGNING_KEY_PATH: signingKeyPath,
  FULLTIME_MANIFEST_TLS_CERT_PATH: tlsCertificatePath,
  FULLTIME_MANIFEST_TLS_KEY_PATH: tlsPrivateKeyPath,
  FULLTIME_MANIFEST_HOST: '127.0.0.1',
  FULLTIME_MANIFEST_PORT: '58432',
  FULLTIME_MANIFEST_PATH: '/v1/network.json'
}
const child = spawn(process.execPath, ['--import', 'tsx', 'src/replay.ts'], { cwd: packageRoot, env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('exit', (code) => { process.exitCode = code ?? 1 })
