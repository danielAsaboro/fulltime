'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const target = process.argv[2]
if (target !== 'ios' && target !== 'android') {
  throw new Error('Usage: node scripts/bundle-worker.cjs <ios|android>')
}

const outputDirectory = path.join(appRoot, 'generated')
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
const executable = path.join(path.dirname(require.resolve('bare-pack/package')), 'bin.js')
const result = spawnSync(process.execPath, [
  executable,
  '--linked',
  '--imports', path.join(__dirname, 'bare-imports.cjs'),
  '--host', target,
  '--out', path.join(outputDirectory, 'room-worker.bundle.mjs'),
  path.join(repoRoot, 'apps', 'desktop', 'workers', 'rooms.js')
], { cwd: repoRoot, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
