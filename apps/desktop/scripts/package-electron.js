#!/usr/bin/env node
'use strict'

/** Build a real unpacked Electron bundle after package-web staged public resources. */

const fs = require('fs')
const path = require('path')

const { packager } = require('@electron/packager')

const desktopRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(desktopRoot, '../..')
const stageRoot = path.join(desktopRoot, 'dist')
const outputRoot = path.join(repositoryRoot, 'release')
const rootNodeModules = path.join(repositoryRoot, 'node_modules')
const packageJson = require(path.join(desktopRoot, 'package.json'))
const electronVersion = require('electron/package.json').version

async function main () {
  const webResources = path.join(stageRoot, 'fulltime-web')
  const trustResources = path.join(stageRoot, 'fulltime')
  const runtimeModules = path.join(stageRoot, 'node_modules')
  if (!fs.existsSync(webResources) || !fs.existsSync(trustResources)) {
    throw new Error('Desktop web resources are missing; run npm run package:web first')
  }
  stageRuntimeDependencies(runtimeModules)
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o755 })
  const bundles = await packager({
    dir: desktopRoot,
    out: outputRoot,
    name: 'FullTime',
    appBundleId: 'com.txoddline.fulltime',
    appCategoryType: 'public.app-category.sports',
    appVersion: packageJson.version,
    buildVersion: packageJson.version,
    platform: process.platform,
    arch: process.arch,
    electronVersion,
    overwrite: true,
    asar: false,
    prune: true,
    extraResource: [webResources, trustResources, runtimeModules],
    ignore: (source) => {
      const normalized = String(source).replace(/\\/g, '/')
      const absolute = path.isAbsolute(source) ? source : path.resolve(desktopRoot, source)
      return /(^|\/)dist(?:\/|$)/.test(normalized) ||
        /(^|\/)\.local-development(?:\/|$)/.test(normalized) ||
        absolute.startsWith(stageRoot) ||
        /(^|\/)test(?:\/|$)/.test(normalized) || absolute.includes(`${path.sep}test${path.sep}`)
    }
  })
  for (const bundle of bundles) verifyBundle(bundle)
  process.stdout.write(`[fulltime desktop package] built ${bundles.join(', ')}\n`)
}

function stageRuntimeDependencies (destinationRoot) {
  if (!fs.existsSync(rootNodeModules)) throw new Error('Workspace node_modules is missing')
  fs.rmSync(destinationRoot, { recursive: true, force: true })
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o755 })
  const queue = Object.keys(packageJson.dependencies || {}).filter((name) => name !== '@fulltime/shared')
  const copied = new Set()
  while (queue.length) {
    const name = queue.shift()
    if (!name || copied.has(name)) continue
    const source = packageDirectory(rootNodeModules, name)
    if (!fs.existsSync(source)) {
      throw new Error(`Runtime dependency ${name} is missing from workspace node_modules`)
    }
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
    copied.add(name)
    const destination = packageDirectory(destinationRoot, name)
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 })
    fs.cpSync(source, destination, { recursive: true, dereference: true })
    for (const dependency of Object.keys({
      ...(metadata.dependencies || {}),
      ...(metadata.optionalDependencies || {}),
      ...(metadata.peerDependencies || {})
    })) {
      if (fs.existsSync(packageDirectory(rootNodeModules, dependency))) queue.push(dependency)
    }
  }
  removePackageManagerBins(destinationRoot)
}

// npm workspace `.bin` entries are build-time command links. Some nested
// packages contain absolute links back into the developer checkout; carrying
// those into a macOS bundle both leaks a local path and makes strict code-sign
// verification reject the app. Runtime imports never resolve through `.bin`.
function removePackageManagerBins (root) {
  const queue = [root]
  while (queue.length) {
    const directory = queue.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.name === '.bin') {
        fs.rmSync(filename, { recursive: true, force: true })
      } else if (entry.isDirectory()) {
        queue.push(filename)
      }
    }
  }
}

function packageDirectory (nodeModulesRoot, packageName) {
  return path.join(nodeModulesRoot, ...packageName.split('/'))
}

function verifyBundle (bundle) {
  const resources = process.platform === 'darwin'
    ? path.join(bundle, 'FullTime.app', 'Contents', 'Resources')
    : path.join(bundle, 'resources')
  const required = [
    path.join(resources, 'fulltime-web'),
    path.join(resources, 'fulltime', 'release-config.json'),
    path.join(resources, 'node_modules', 'pear-runtime'),
    path.join(resources, 'node_modules', 'framed-stream')
  ]
  for (const filename of required) {
    if (!fs.existsSync(filename)) throw new Error(`Packaged Electron bundle is missing ${filename}`)
  }
}

main().catch((error) => {
  process.stderr.write(`[fulltime desktop package] failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
