#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(import.meta.dirname, '..')
const invitePath = process.env.FULLTIME_TEST_INVITE_FILE || '/private/tmp/fulltime-physical-e2e-invite.txt'
const device = process.env.FULLTIME_IOS_DEVICE || '00008101-001035013468801E'
const resultPath = path.resolve(
  process.env.FULLTIME_IOS_RESULT_PATH ||
    path.join(repoRoot, 'evidence', 'physical-e2e', `ios-join-${Date.now()}.xcresult`)
)
const invite = fs.readFileSync(invitePath, 'utf8').trim()

if (!invite.startsWith('ft2.') || invite.length < 100) {
  throw new Error(`Refusing to run with an invalid FullTime invite from ${invitePath}`)
}
fs.mkdirSync(path.dirname(resultPath), { recursive: true })
if (fs.existsSync(resultPath)) {
  throw new Error(`Refusing to overwrite existing XCTest evidence: ${resultPath}`)
}

const productsDir = path.join(repoRoot, 'apps/mobile/.local-development/ios-ui-test-derived-data/Build/Products')
const appConfigPath = path.join(productsDir, 'Release-iphoneos/FullTime.app/EXConstants.bundle/app.config')
const localNetworkPath = path.join(repoRoot, 'apps/mobile/.local-development/network-config.json')
if (!fs.existsSync(appConfigPath) || !fs.existsSync(localNetworkPath)) {
  throw new Error('The physical iOS test requires a Release app built with FULLTIME_MOBILE_PROFILE=local')
}
const embeddedConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'))
const localNetwork = JSON.parse(fs.readFileSync(localNetworkPath, 'utf8'))
const embeddedFeedKey = embeddedConfig?.extra?.fullTimeNetwork?.initialManifest?.fixtureFeedKey
const expectedFeedKey = localNetwork?.initialManifest?.fixtureFeedKey
if (!expectedFeedKey || embeddedFeedKey !== expectedFeedKey) {
  throw new Error('The physical iOS test app does not embed the currently verified local authority feed key')
}
const testRunName = fs.readdirSync(productsDir).find((name) => name.endsWith('.xctestrun'))
if (!testRunName) {
  throw new Error('No .xctestrun manifest found; run the physical iOS build-for-testing step first')
}
const privateTestRunPath = path.join(productsDir, `.fulltime-private-${process.pid}.xctestrun`)
fs.copyFileSync(path.join(productsDir, testRunName), privateTestRunPath, fs.constants.COPYFILE_EXCL)
fs.chmodSync(privateTestRunPath, 0o600)
const configure = spawnSync(
  '/usr/libexec/PlistBuddy',
  ['-c', `Add :FullTimeTests:EnvironmentVariables:FULLTIME_TEST_INVITE string ${invite}`, privateTestRunPath],
  { stdio: 'inherit' }
)
if (configure.status !== 0) {
  fs.unlinkSync(privateTestRunPath)
  throw new Error('Could not configure the private XCTest runner environment')
}

let result
try {
  result = spawnSync(
    'xcodebuild',
    [
      '-quiet',
      '-xctestrun', privateTestRunPath,
      '-destination', `id=${device}`,
      '-resultBundlePath', resultPath,
      '-allowProvisioningUpdates',
      'test-without-building',
      '-only-testing:FullTimeTests/FullTimeUITests/testJoinAuthenticatedRoom'
    ],
    { cwd: repoRoot, env: process.env, stdio: 'inherit' }
  )
} finally {
  fs.unlinkSync(privateTestRunPath)
}

console.log(`XCTest result bundle: ${resultPath}`)
process.exit(result.status ?? 1)
