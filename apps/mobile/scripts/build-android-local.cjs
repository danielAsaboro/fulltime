'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appRoot = path.resolve(__dirname, '..')
const localRoot = path.join(appRoot, '.local-development', 'android')
const defaultJavaHome = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
const defaultAndroidHome = '/opt/homebrew/share/android-commandlinetools'
const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'production',
  JAVA_HOME: process.env.JAVA_HOME || defaultJavaHome,
  ANDROID_HOME: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultAndroidHome,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || defaultAndroidHome,
  FULLTIME_MOBILE_PROFILE: 'local'
}

const bareKitPackage = require('react-native-bare-kit/package.json')
const bareKitManifest = fs.readFileSync(
  path.join(path.dirname(require.resolve('react-native-bare-kit/package.json')), 'android', 'libs', 'bare-kit', 'AndroidManifest.xml'),
  'utf8'
)

if (bareKitPackage.version !== '0.14.5' || !/android:minSdkVersion=["']29["']/.test(bareKitManifest)) {
  throw new Error(
    `Android 10 builds require the verified API 29 Bare Kit runtime (react-native-bare-kit 0.14.5); found ${bareKitPackage.version}`
  )
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || appRoot,
    env,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit'
  })
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status || 1)
  }
  return options.capture ? result.stdout : ''
}

run(process.execPath, [path.join(appRoot, 'scripts', 'configure-local.cjs')])
run(process.execPath, [path.join(appRoot, 'scripts', 'bundle-worker.cjs'), 'android'])
run(process.execPath, [path.join(appRoot, 'scripts', 'link-android-addons.cjs')])
run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android'])
// The React Native Gradle task does not declare the generated Bare worker as
// an input. Force the JS asset task so every local APK embeds the worker that
// was produced immediately above rather than a stale Metro output.
run(path.join(appRoot, 'android', 'gradlew'), [':app:createBundleReleaseJsAndAssets', '--rerun-tasks'], { cwd: path.join(appRoot, 'android') })
run(path.join(appRoot, 'android', 'gradlew'), ['assembleRelease'], { cwd: path.join(appRoot, 'android') })

const builtApk = path.join(appRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (!fs.existsSync(builtApk) || fs.statSync(builtApk).size === 0) {
  throw new Error(`Android Release build did not produce a non-empty APK at ${builtApk}`)
}

const entries = run('unzip', ['-Z1', builtApk], { capture: true }).split('\n')
if (!entries.includes('assets/index.android.bundle')) {
  throw new Error('Android Release APK did not embed assets/index.android.bundle')
}
if (!entries.some((entry) => /^lib\/[^/]+\/libbare-kit\.so$/.test(entry))) {
  throw new Error('Android Release APK did not embed the Bare Kit runtime')
}
if (!entries.some((entry) => /^lib\/[^/]+\/librocksdb-native\.[^/]+\.so$/.test(entry))) {
  throw new Error('Android Release APK did not embed the linked FullTime storage addon')
}

const apkAnalyzer = path.join(env.ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', 'apkanalyzer')
const minSdk = run(apkAnalyzer, ['manifest', 'min-sdk', builtApk], { capture: true }).trim()
if (minSdk !== '29') {
  throw new Error(`Android Release APK must support the target Android 10 device at API 29; found minSdk ${minSdk}`)
}
const manifest = run(apkAnalyzer, ['manifest', 'print', builtApk], { capture: true })
if (!/android:usesCleartextTraffic="true"/.test(manifest)) {
  throw new Error('Android local Release APK must allow the configured LAN HTTP Slip gateway')
}

fs.mkdirSync(localRoot, { recursive: true, mode: 0o700 })
const output = path.join(localRoot, 'FullTime-local-release.apk')
fs.copyFileSync(builtApk, output)
console.log(`Verified FullTime Android Release APK: ${output}`)
