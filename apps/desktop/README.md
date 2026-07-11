# FullTime desktop peer rooms

Electron owns one `DesktopPeerController`: one device-sealed identity, one Pear
Runtime Bare worker, one Corestore, and one set of rooms. The Electron preload
bridge and the loopback browser bridge both call that controller, so opening
the UI in a normal browser never creates a second browser identity or a second
room store.

At startup the desktop loads its embedded verification public key and manifest
endpoint, verifies the FullTime network manifest, caches only a verified copy,
then starts the worker with the manifest's fixture and optional answer-authority
pins. It never reads a consumer fixture key, TxLINE credentials, or a web
gateway secret.

`DesktopLocalHost` binds only `127.0.0.1` on a random port. It starts a private
Next upstream, serves Electron and a normal browser through that one origin,
and intercepts `/api/peer/*` locally. **Open in browser** creates a one-use,
five-minute capability URL; exchanging it creates an in-memory `HttpOnly`
`SameSite=Strict` cookie. The bridge rejects unknown hosts/origins, malformed
v2 frames, unbounded SSE use, and all browser sessions when Electron exits.

## Development

    npm run desktop:dev

The desktop release configuration is an operator/release artifact. In an
unpackaged development build, a local HTTPS (or loopback HTTP) manifest can be
supplied only through `FULLTIME_DEV_NETWORK_MANIFEST_URL` and
`FULLTIME_DEV_NETWORK_MANIFEST_PUBLIC_KEY`; those are development deployment
settings, not consumer configuration.

`npm run web:ui` starts Next for layout/UI work only. It has no peer backend on
its own. Use `npm run desktop:dev` for the local product path.

## Verification

    npm --workspace @fulltime/desktop run check
    npm --workspace @fulltime/desktop test
    npm --workspace @fulltime/desktop run test:localhost
    FULLTIME_RUN_PEAR_INTEGRATION=1 npm --workspace @fulltime/desktop run test:integration

`test:localhost` is separate because restricted CI sandboxes can prohibit even
loopback TCP binding. The integration suite uses a real local DHT, signed
fixture publisher, BlindPairing admission, Autobase replication, preload-side
controller requests, and a normal HTTP browser session.

For manifest signing, TLS deployment, packaging, and authority rotation, see
[operator deployment documentation](../../docs/operator-deployment.md).
