/* eslint-disable @typescript-eslint/no-require-imports */
/* Clear stale Next dev route declarations before invoking TypeScript. */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const devTypes = path.join(process.cwd(), '.next', 'dev', 'types')
fs.rmSync(devTypes, { recursive: true, force: true })
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit'], {
  cwd: process.cwd(),
  stdio: 'inherit'
})
process.exitCode = result.status === null ? 1 : result.status
