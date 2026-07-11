# FullTime operator deployment

This document is for the FullTime operator. It is not desktop or browser setup.
Consumers install and start the desktop application; they never receive TxLINE
credentials, fixture publisher keys, manifest signing keys, gateway secrets, or
answer-attestor configuration.

## Local operator development

With real TxLINE credentials in the repo-root `.env`, start live ingest plus a
locally trusted HTTPS manifest:

    npm run operator:local-live

Then launch the desktop:

    npm run desktop:local-config

`operator:local-live` maps `TXLINE_BASE_URL` and
`TXLINE_DEFAULT_FIXTURE_ID`, generates protected local manifest/TLS keys, and
keeps TxLINE secrets out of the Electron environment. Only `NEXT_PUBLIC_*`
values are forwarded to the local UI.

To exercise the same signed authority boundary without TxLINE records, start
the explicit empty operator-owned development authority instead:

    npm run operator:local-config

Then use the same desktop command against its signed loopback manifest:

    npm run desktop:local-config

This uses the production Hypercore publisher, persistent Ed25519 manifest key,
manifest verification/cache, Pear worker, and local Next host. It publishes no
fixtures until the normal TxLINE operator service writes real feed records into
the persistent publisher.

## Persistent authorities

Run `@fulltime/worker` as the single writer for the fixture plane. Its
`FIXTURE_PLANE_DIR` must be durable storage: the named Hypercore inside that
directory is the publisher identity whose key is placed into the signed network
manifest. Replacing the directory changes the authority and requires a manifest
and desktop-release update.

Put TxLINE tokens/activation material, the Ed25519 manifest signing key, and
TLS key material in protected service secret storage. The worker refuses to
start when any required operator boundary is absent; it does not replace live
fixtures with local data.

Start from the operator-only [`.env.example`](../.env.example), then run:

    npm run operator:publisher

The service opens the persistent publisher, signs the active feed key plus any
configured answer-attestor/receipt-feed and anchor-observer pins, and serves
that document at `FULLTIME_MANIFEST_PUBLIC_URL` over HTTPS. It logs the safe
verification public key needed by the desktop release, never the signing key.

## Manifest deployment

The HTTPS service must expose the exact configured path and return the signed
JSON body unchanged. A CDN or reverse proxy may terminate public TLS only if it
does not transform the body. The desktop canonicalizes the JSON before
verifying its Ed25519 signature.

For a static/CDN deployment, build a signed document from the persistent
publisher instead of inventing a feed key:

    FULLTIME_MANIFEST_OUTPUT_PATH=/secure/staging/network.json \
      npm run operator:manifest:sign

Upload that output to `FULLTIME_MANIFEST_PUBLIC_URL`, then verify the public
deployment with the release verification PEM:

    FULLTIME_MANIFEST_PUBLIC_URL=https://config.example.com/v1/network.json \
    FULLTIME_MANIFEST_PUBLIC_KEY_PATH=/path/to/public-key.pem \
      npm run operator:manifest:verify

Set either `FULLTIME_MANIFEST_PUBLIC_KEY` to PEM text or
`FULLTIME_MANIFEST_PUBLIC_KEY_PATH` to a PEM file; neither is a private key.

## Desktop release trust root

Before packaging a release, pass the public manifest URL and Ed25519 public
key to the staging command. It copies only the Next standalone UI and a
`release-config.json` containing those two public values; it rejects missing
values and never copies operator secrets.

    FULLTIME_RELEASE_MANIFEST_URL=https://config.example.com/v1/network.json \
    FULLTIME_RELEASE_MANIFEST_PUBLIC_KEY_PATH=/path/to/public-key.pem \
      npm run desktop:package

`desktop:package` stages the standalone UI and trust root, then invokes
Electron Packager to place `fulltime-web` and `fulltime/release-config.json`
under the application resources. The runtime starts the bundled standalone
server only on `127.0.0.1` and uses that release config as its trust root.

## Pin changes and rotation

Changing the fixture publisher, answer-attestor, receipt-feed, or future
anchor-observer changes the signed manifest. Publish a newly signed manifest
only after the new authority is live and reachable. Clients with a verified
previous manifest may continue offline in visibly stale mode; clients without a
verified manifest do not start a room worker.

Ed25519 root rotation needs a release rollout:

1. Generate a new signing key in protected operator storage and build a desktop
   release embedding its public key.
2. Keep serving a manifest signed by the old key until the release rollout is
   complete; the manifest format intentionally has one signer, not an
   unverifiable key list.
3. Switch the manifest service/static deploy to the new signing key and run
   `npm run operator:manifest:verify` with the new public key.
4. Revoke access to the old private key only after the old desktop release is
   outside the supported window.

Do not add a second unsigned endpoint or make a desktop fall back to a fixture
key from a room invitation. A room can reference signed facts, but cannot choose
or mint the authority that signs them.

## Operator checks

Run these before deployment:

    npm --workspace @fulltime/worker run typecheck
    npm --workspace @fulltime/worker run test
    npm run operator:manifest:verify
    npm --workspace @fulltime/desktop run check
    npm --workspace @fulltime/desktop run test:localhost

After `desktop:package`, run the standalone packaging smoke with the generated
`fulltime-web` resource path:

    FULLTIME_PACKAGED_WEB_ROOT=/path/to/FullTime.app/Contents/Resources/fulltime-web \
      npm --workspace @fulltime/desktop run test:package-smoke

The local-host test binds loopback TCP and is intentionally separate because
restricted CI sandboxes can deny local socket binding. The real DHT integration
is likewise opt-in:

    FULLTIME_RUN_PEAR_INTEGRATION=1 npm --workspace @fulltime/desktop run test:integration
