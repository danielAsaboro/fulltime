'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const repoRoot = path.resolve(root, '../..')
const defaultJavaHome = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
const defaultAndroidHome = '/opt/homebrew/share/android-commandlinetools'
const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'production',
  JAVA_HOME: process.env.JAVA_HOME || defaultJavaHome,
  ANDROID_HOME: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultAndroidHome,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || defaultAndroidHome,
  FULLTIME_MOBILE_PROFILE: 'release'
}
const required = [
  'FULLTIME_ANDROID_KEYSTORE_PATH',
  'FULLTIME_ANDROID_KEYSTORE_PASSWORD',
  'FULLTIME_ANDROID_KEY_ALIAS',
  'FULLTIME_ANDROID_KEY_PASSWORD'
]

for (const name of required) {
  if (!env[name]) throw new Error(`${name} is required for an installable FullTime release APK`)
}
if (!fs.existsSync(env.FULLTIME_ANDROID_KEYSTORE_PATH)) {
  throw new Error(`Android release keystore not found: ${env.FULLTIME_ANDROID_KEYSTORE_PATH}`)
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

run(process.execPath, ['scripts/bundle-worker.cjs', 'android'])
run(process.execPath, ['scripts/link-android-addons.cjs'])
run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android'])
run(path.join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['assembleRelease'], path.join(root, 'android'))

const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (!fs.existsSync(apk) || fs.statSync(apk).size === 0) throw new Error(`Release APK was not produced: ${apk}`)

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' })
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status || 1)
  }
  return result.stdout
}

const entries = capture('unzip', ['-Z1', apk]).split('\n')
if (!entries.includes('assets/index.android.bundle')) throw new Error('Release APK does not contain the Hermes application bundle')
if (!entries.some((entry) => /^lib\/[^/]+\/libbare-kit\.so$/.test(entry))) throw new Error('Release APK does not contain the Bare Kit runtime')
if (!entries.some((entry) => /^lib\/[^/]+\/librocksdb-native\.[^/]+\.so$/.test(entry))) throw new Error('Release APK does not contain the linked RocksDB addon')

const analyzer = path.join(env.ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', 'apkanalyzer')
if (capture(analyzer, ['manifest', 'min-sdk', apk]).trim() !== '29') throw new Error('Release APK must support Android API 29')
if (/android:usesCleartextTraffic=["']true["']/.test(capture(analyzer, ['manifest', 'print', apk]))) {
  throw new Error('Release APK unexpectedly permits cleartext network traffic')
}

const buildToolsRoot = path.join(env.ANDROID_HOME, 'build-tools')
const buildTools = fs.readdirSync(buildToolsRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
const apkSigner = path.join(buildToolsRoot, buildTools, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner')
run(apkSigner, ['verify', '--verbose', '--print-certs', apk])

const outputDir = path.join(repoRoot, 'release')
fs.mkdirSync(outputDir, { recursive: true })
const output = path.join(outputDir, 'FullTime-0.1.0-android.apk')
fs.copyFileSync(apk, output)
console.log(`[fulltime mobile] built and verified signed release APK ${output}`)
