'use strict'

const path = require('path')
const fs = require('fs')

const desktopRoot = path.resolve(__dirname, '..')
const runtimePath = path.resolve(desktopRoot, '../worker/.local-development/replay-runtime.json')
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
if (runtime.kind !== 'txline-replay' || !Number.isSafeInteger(runtime.startedAt)) {
  throw new Error('Authenticated replay runtime is unavailable or invalid')
}
process.env.FULLTIME_LOCAL_RUNTIME_PATH = runtimePath
// Every replay operator owns a fresh immutable fixture feed. Isolate its room
// profile as well so durable rooms never retain a stale publisher pin.
process.env.FULLTIME_LOCAL_STORAGE_PATH = path.join(desktopRoot, '.local-development', `peer-store-replay-${runtime.startedAt}`)
process.env.FULLTIME_LOCAL_DESKTOP_NAME = 'FullTime · Norway vs England replay'

require('./start-local-config.js')
