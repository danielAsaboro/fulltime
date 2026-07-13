'use strict'

const fs = require('fs')
const path = require('path')
const link = require('bare-link')

async function main() {
  const appRoot = path.resolve(__dirname, '..')
  const repoRoot = path.resolve(appRoot, '..', '..')
  const workerPackage = path.join(repoRoot, 'apps', 'desktop')
  const kitRoot = path.dirname(require.resolve('react-native-bare-kit/package'))
  const output = path.join(kitRoot, 'android', 'src', 'main', 'addons')
  fs.mkdirSync(output, { recursive: true })
  let count = 0
  for await (const resource of link(workerPackage, {
    hosts: ['android-arm64', 'android-arm', 'android-ia32', 'android-x64'],
    out: output
  })) {
    count++
    console.log(`Linked ${path.relative(output, resource)}`)
  }
  if (count === 0) throw new Error('The FullTime room worker dependency graph produced no linked Android addons')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
