'use strict'

const fs = require('fs')
const path = require('path')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const root = __dirname
const release = readJson(path.join(root, 'release-config.json'))
const localPath = path.join(root, '.local-development', 'network-config.json')
const useLocal = process.env.FULLTIME_MOBILE_PROFILE === 'local'
const network = useLocal && fs.existsSync(localPath) ? readJson(localPath) : release

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
        UIBackgroundModes: []
      }
    },
    android: {
      package: 'com.txoddline.fulltime'
    },
    plugins: [
      'expo-secure-store',
      'expo-sharing',
      ['expo-camera', { cameraPermission: 'Allow FullTime to scan encrypted room invite QR codes.' }],
      ['expo-build-properties', { android: { minSdkVersion: 29 } }]
    ],
    extra: {
      fullTimeNetwork: network
    }
  }
}
