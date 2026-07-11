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

## Checks

    npm --workspace @fulltime/mobile run typecheck
    npm --workspace @fulltime/mobile run test
    npm --workspace @fulltime/mobile run bundle:ios
    npm --workspace @fulltime/mobile run link:ios

The linked addon step must produce non-empty iOS XCFrameworks. An Expo shell
that starts without those frameworks is not a functional FullTime peer.
