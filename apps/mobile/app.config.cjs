'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { withAppBuildGradle, withEntitlementsPlist } = require('@expo/config-plugins')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const root = __dirname
const release = readJson(path.join(root, 'release-config.json'))
const localPath = path.join(root, '.local-development', 'network-config.json')
const useLocal = process.env.FULLTIME_MOBILE_PROFILE === 'local'
const cachedNetwork = useLocal && fs.existsSync(localPath) ? readJson(localPath) : release
const repoEnvPath = path.resolve(root, '../..', '.env')
const repoEnv = fs.existsSync(repoEnvPath) ? require('util').parseEnv(fs.readFileSync(repoEnvPath, 'utf8')) : {}
const privyAppId = process.env.PRIVY_APP_ID || repoEnv.PRIVY_APP_ID || null
const privyClientId = process.env.PRIVY_CLIENT_ID || repoEnv.PRIVY_CLIENT_ID || null

function localGatewayOrigin() {
  if (process.env.FULLTIME_MOBILE_SLIP_GATEWAY_ORIGIN) return process.env.FULLTIME_MOBILE_SLIP_GATEWAY_ORIGIN
  for (const entries of Object.values(os.networkInterfaces())) {
    const candidate = entries?.find((entry) => entry.family === 'IPv4' && !entry.internal)
    if (candidate) return `http://${candidate.address}:3013`
  }
  return null
}

const slipGatewayOrigin = useLocal ? localGatewayOrigin() : null
const linkPreviewOrigin = slipGatewayOrigin || process.env.FULLTIME_LINK_PREVIEW_ORIGIN || null
const network = useLocal && slipGatewayOrigin ? {
  ...cachedNetwork,
  fixtureRelay: { host: new URL(slipGatewayOrigin).hostname, port: 59638 }
} : cachedNetwork
const slip = useLocal && slipGatewayOrigin ? {
  network: 'localnet',
  rpcUrl: `${slipGatewayOrigin}/api/slip/rpc`,
  fundingUrl: `${slipGatewayOrigin}/api/slip/fund`,
  compilerUrl: `${slipGatewayOrigin}/api/slip/compile`,
  program: process.env.NEXT_PUBLIC_SLIP_PROGRAM_ID || repoEnv.NEXT_PUBLIC_SLIP_PROGRAM_ID,
  mint: process.env.NEXT_PUBLIC_SLIP_SETTLEMENT_MINT || repoEnv.NEXT_PUBLIC_SLIP_SETTLEMENT_MINT
} : null

function withoutInactivePrivyEntitlements(config) {
  return withEntitlementsPlist(config, (next) => {
    delete next.modResults['com.apple.developer.applesignin']
    return next
  })
}

function withFullTimeAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (next) => {
    if (next.modResults.language !== 'groovy') {
      throw new Error('FullTime Android release signing requires a Groovy app build.gradle')
    }
    let contents = next.modResults.contents
    const anchor = 'android {\n    ndkVersion rootProject.ext.ndkVersion'
    const variables = `def fullTimeReleaseStoreFile = System.getenv('FULLTIME_ANDROID_KEYSTORE_PATH')
def fullTimeReleaseStorePassword = System.getenv('FULLTIME_ANDROID_KEYSTORE_PASSWORD')
def fullTimeReleaseKeyAlias = System.getenv('FULLTIME_ANDROID_KEY_ALIAS')
def fullTimeReleaseKeyPassword = System.getenv('FULLTIME_ANDROID_KEY_PASSWORD')
def fullTimeReleaseSigningConfigured = [fullTimeReleaseStoreFile, fullTimeReleaseStorePassword, fullTimeReleaseKeyAlias, fullTimeReleaseKeyPassword].every { it }
def fullTimeLocalProfile = System.getenv('FULLTIME_MOBILE_PROFILE') == 'local'

android {
    ndkVersion rootProject.ext.ndkVersion`
    if (!contents.includes('def fullTimeReleaseStoreFile')) {
      if (!contents.includes(anchor)) throw new Error('Could not locate Android configuration for release signing')
      contents = contents.replace(anchor, variables)
    }
    if (!contents.includes('def fullTimeLocalProfile')) {
      const configuredLine = "def fullTimeReleaseSigningConfigured = [fullTimeReleaseStoreFile, fullTimeReleaseStorePassword, fullTimeReleaseKeyAlias, fullTimeReleaseKeyPassword].every { it }"
      if (!contents.includes(configuredLine)) throw new Error('Could not locate Android release signing variables')
      contents = contents.replace(configuredLine, `${configuredLine}\ndef fullTimeLocalProfile = System.getenv('FULLTIME_MOBILE_PROFILE') == 'local'`)
    }

    const signingAnchor = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`
    const signingReplacement = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        if (fullTimeReleaseSigningConfigured) {
            fullTimeRelease {
                storeFile file(fullTimeReleaseStoreFile)
                storePassword fullTimeReleaseStorePassword
                keyAlias fullTimeReleaseKeyAlias
                keyPassword fullTimeReleaseKeyPassword
            }
        }
    }`
    if (!contents.includes('fullTimeRelease {')) {
      if (!contents.includes(signingAnchor)) throw new Error('Could not locate Android signing configuration')
      contents = contents.replace(signingAnchor, signingReplacement)
    }

    const releaseAnchor = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`
    const releaseReplacement = `        release {
            if (!fullTimeReleaseSigningConfigured) {
                throw new GradleException('Release signing requires FULLTIME_ANDROID_KEYSTORE_PATH, FULLTIME_ANDROID_KEYSTORE_PASSWORD, FULLTIME_ANDROID_KEY_ALIAS, and FULLTIME_ANDROID_KEY_PASSWORD')
            }
            signingConfig signingConfigs.fullTimeRelease`
    if (!contents.includes('signingConfig signingConfigs.fullTimeRelease')) {
      if (!contents.includes(releaseAnchor)) throw new Error('Could not locate Android release build type')
      contents = contents.replace(releaseAnchor, releaseReplacement)
    }
    const strictReleaseSigning = `        release {
            if (!fullTimeReleaseSigningConfigured) {
                throw new GradleException('Release signing requires FULLTIME_ANDROID_KEYSTORE_PATH, FULLTIME_ANDROID_KEYSTORE_PASSWORD, FULLTIME_ANDROID_KEY_ALIAS, and FULLTIME_ANDROID_KEY_PASSWORD')
            }
            signingConfig signingConfigs.fullTimeRelease`
    const localAwareReleaseSigning = `        release {
            if (fullTimeLocalProfile) {
                // The local profile embeds only verified development authority
                // pins and is installed directly on a connected test device.
                signingConfig signingConfigs.debug
            } else {
                if (!fullTimeReleaseSigningConfigured) {
                    throw new GradleException('Release signing requires FULLTIME_ANDROID_KEYSTORE_PATH, FULLTIME_ANDROID_KEYSTORE_PASSWORD, FULLTIME_ANDROID_KEY_ALIAS, and FULLTIME_ANDROID_KEY_PASSWORD')
                }
                signingConfig signingConfigs.fullTimeRelease
            }`
    if (contents.includes(strictReleaseSigning)) {
      contents = contents.replace(strictReleaseSigning, localAwareReleaseSigning)
    }
    next.modResults.contents = contents
    return next
  })
}

module.exports = {
  expo: {
    name: 'FullTime',
    slug: 'fulltime',
    version: '0.1.0',
    icon: './assets/fulltime-app-icon.png',
    orientation: 'portrait',
    scheme: 'fulltime',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.txoddline.fulltime',
      infoPlist: {
        NSLocalNetworkUsageDescription: 'FullTime uses peer-to-peer networking to replicate private match rooms.',
        ...(useLocal ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
        UIBackgroundModes: []
      }
    },
    android: {
      package: 'com.txoddline.fulltime'
    },
    plugins: [
      'expo-secure-store',
      'expo-sharing',
      'expo-web-browser',
      ['expo-camera', { cameraPermission: 'Allow FullTime to scan encrypted room invite QR codes.' }],
      ['expo-build-properties', { android: { minSdkVersion: 29, usesCleartextTraffic: useLocal } }],
      withFullTimeAndroidReleaseSigning,
      withoutInactivePrivyEntitlements
    ],
    extra: {
      fullTimeNetwork: network,
      privy: {
        appId: privyAppId,
        clientId: privyClientId
      },
      slip,
      linkPreviewUrl: linkPreviewOrigin ? `${linkPreviewOrigin}/api/link-preview` : null
    }
  }
}
