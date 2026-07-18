'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { withEntitlementsPlist } = require('@expo/config-plugins')

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
