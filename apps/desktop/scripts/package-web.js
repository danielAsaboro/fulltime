#!/usr/bin/env node
'use strict'

/**
 * Stages the Next standalone server and the public release trust root for an
 * Electron packager. No TxLINE credential, publisher secret, or private
 * manifest signing key is copied into this directory.
 */

const fs = require('fs')
const path = require('path')

const { parseManifestEndpoint, parseVerificationKey } = require('../lib/release-config.js')
const { findStandaloneServer } = require('../lib/web-upstream.js')

const desktopRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '../..')
const webRoot = path.join(repositoryRoot, 'apps/web')
const outputRoot = path.join(desktopRoot, 'dist')
const webOutput = path.join(outputRoot, 'fulltime-web')
const configOutput = path.join(outputRoot, 'fulltime', 'release-config.json')

function main () {
  const networkManifestUrl = process.env.FULLTIME_RELEASE_MANIFEST_URL
  const networkManifestPublicKey = readReleasePublicKey()
  if (typeof networkManifestUrl !== 'string' || !networkManifestUrl ||
      typeof networkManifestPublicKey !== 'string' || !networkManifestPublicKey) {
    throw new Error('Desktop packaging requires FULLTIME_RELEASE_MANIFEST_URL and a FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY or FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY_PATH')
  }
  const endpoint = parseManifestEndpoint(networkManifestUrl, false)
  const publicKey = parseVerificationKey(networkManifestPublicKey)
  const standaloneServer = findStandaloneServer(undefined, webRoot)
  const standaloneRoot = standaloneServer.endsWith(`${path.sep}apps${path.sep}web${path.sep}server.js`)
    ? path.resolve(path.dirname(standaloneServer), '../..')
    : path.dirname(standaloneServer)

  fs.rmSync(outputRoot, { recursive: true, force: true })
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o755 })
  fs.cpSync(standaloneRoot, webOutput, { recursive: true })
  const packagedAppRoot = standaloneServer.endsWith(`${path.sep}apps${path.sep}web${path.sep}server.js`)
    ? path.join(webOutput, 'apps', 'web')
    : webOutput
  fs.cpSync(path.join(webRoot, '.next', 'static'), path.join(packagedAppRoot, '.next', 'static'), { recursive: true })
  fs.cpSync(path.join(webRoot, 'public'), path.join(packagedAppRoot, 'public'), { recursive: true })
  fs.mkdirSync(path.dirname(configOutput), { recursive: true, mode: 0o755 })
  fs.writeFileSync(configOutput, JSON.stringify({
    networkManifestUrl: endpoint.toString(),
    networkManifestPublicKey: publicKey.export({ type: 'spki', format: 'pem' })
  }), { mode: 0o644 })
  process.stdout.write(`[fulltime desktop package] staged ${webOutput} and release configuration without operator secrets\n`)
}

function readReleasePublicKey () {
  const inline = process.env.FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY
  const filename = process.env.FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY_PATH
  if (inline && filename) throw new Error('Set only one of FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY or FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY_PATH')
  if (inline) return inline
  if (!filename) return ''
  try {
    return fs.readFileSync(filename, 'utf8')
  } catch (error) {
    throw new Error(`Could not read FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY_PATH: ${error instanceof Error ? error.message : String(error)}`)
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`[fulltime desktop package] failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
