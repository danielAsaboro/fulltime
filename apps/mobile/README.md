# FullTime mobile

The mobile app is a native Expo/React Native shell around one device-owned
Bare Kit worklet. The worklet is the same room core used by desktop: it owns
the mobile identity, Corestore, Hyperswarm, BlindPairing, Autobase, fixture
feed, presence, and durable room history. React Native receives only validated
v2 request responses and events over the framed IPC stream.

## Local iPhone build

1. Start the real operator publisher from the repository root:

       npm run operator:local-live

2. Add an Apple ID/team in Xcode under **Settings → Accounts**. A physical
   device build cannot create its development provisioning profile without an
   account configured in Xcode.
3. Connect, unlock, and trust the iPhone, then run:

       npm run mobile:ios

The command verifies the operator-signed local manifest, writes only its
public pins into an ignored local build profile, bundles the room core with
`bare-pack --linked`, links its real iOS addons with `bare-link`, prebuilds the
native project, and installs it on the configured iPhone UDID. TxLINE tokens,
publisher storage, signing private keys, and activation credentials never
enter the mobile build.

For a release, set `release-config.json` to the production HTTPS manifest URL
and embedded Ed25519 verification key. Do not commit a local manifest or use a
fixture-feed environment override.

## Local Android build

Start the real local operator publisher as described above, then run:

    npm run mobile:android

The command verifies the operator-signed local manifest, bundles the room core
for Android, links its real native addons for all four Android ABIs, prebuilds
the Expo project, and creates a self-contained Release APK at
`.local-development/android/FullTime-local-release.apk`. The build fails if the
APK does not contain the Hermes application bundle, Bare Kit runtime, and
linked RocksDB storage addon. It uses `JAVA_HOME`, `ANDROID_HOME`, and
`ANDROID_SDK_ROOT` when set; the Homebrew JDK 17 and Android command-line tools
locations are the macOS defaults. The Android build pins the last official
Bare Kit runtime compiled for API 29 (`react-native-bare-kit` 0.14.5), so the
real peer worker runs on Android 10 devices such as the Infinix X683. The build
fails if that dependency floats to an API 31 runtime or if the final APK no
longer declares API 29 support.

The React tree is rooted in `SafeAreaProvider`, and every full-screen app or
modal surface uses the safe-area-context `SafeAreaView`. Android edge-to-edge
windows therefore keep room controls, composers, settings, and the QR scanner
clear of the status and navigation bars.

## Checks

    npm --workspace @fulltime/mobile run typecheck
    npm --workspace @fulltime/mobile run test
    npm --workspace @fulltime/mobile run bundle:android
    npm --workspace @fulltime/mobile run link:android
    npm --workspace @fulltime/mobile run bundle:ios
    npm --workspace @fulltime/mobile run link:ios

The linked addon step must produce non-empty iOS XCFrameworks. An Expo shell
that starts without those frameworks is not a functional FullTime peer.
