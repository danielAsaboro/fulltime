'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appRoot = path.resolve(__dirname, '..')
const env = {
  ...process.env,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer',
  FULLTIME_MOBILE_PROFILE: 'local'
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: appRoot, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

run(process.execPath, [path.join(appRoot, 'scripts', 'configure-local.cjs')])
run(process.execPath, [path.join(appRoot, 'scripts', 'bundle-worker.cjs'), 'ios'])
run(process.execPath, [path.join(appRoot, 'scripts', 'link-ios-addons.cjs')])
run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'ios'])
const device = process.env.FULLTIME_IOS_DEVICE || '00008101-001035013468801E'
const derivedData = path.join(appRoot, '.local-development', 'ios-derived-data')
run('xcodebuild', [
  '-workspace', path.join(appRoot, 'ios', 'FullTime.xcworkspace'),
  '-scheme', 'FullTime',
  '-configuration', 'Release',
  '-destination', `id=${device}`,
  '-derivedDataPath', derivedData,
  'build'
])
const appPath = path.join(derivedData, 'Build', 'Products', 'Release-iphoneos', 'FullTime.app')
const bundlePath = path.join(appPath, 'main.jsbundle')
if (!fs.statSync(bundlePath).isFile() || fs.statSync(bundlePath).size === 0) {
  throw new Error('Release build did not embed main.jsbundle')
}
run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device, appPath])
run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device, 'com.txoddline.fulltime'])
