'use strict'

const fs = require('fs')
const path = require('path')

const runtimePath = path.resolve(__dirname, '../.local-development/replay-runtime.json')
const action = process.argv[2]
if (action !== 'start') throw new Error('Replay control action must be start')
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
if (runtime.kind !== 'txline-replay' || !Number.isSafeInteger(runtime.pid) || runtime.pid < 1) throw new Error('Replay runtime is invalid')
process.kill(runtime.pid, 'SIGUSR1')
console.log(`[fulltime replay] started pid ${runtime.pid}`)
