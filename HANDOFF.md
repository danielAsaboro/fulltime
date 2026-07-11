# FullTime handoff

## Current product surface

- `apps/worker` is an operator-only TxLINE publisher. It persists the signed
  fixture Hypercore and signs/serves the public HTTPS network manifest.
- A desktop verifies that manifest before it starts `workers/rooms.js`. It uses
  a verified cache only when offline, marks the UI stale, and otherwise shows
  configuration unavailable without starting Pear.
- `DesktopPeerController` owns exactly one device identity, Corestore,
  Hyperswarm instance, room catalog, and native-notification worker.
- Electron preload IPC and the Electron-owned loopback browser host call the
  same controller. A browser is admitted only through a one-use capability
  URL, then an in-memory strict HttpOnly cookie.
- The loopback host proxies the bundled/private Next UI and intercepts
  `/api/peer/*`; there is no external web gateway or per-browser worker.
- Room behavior remains encrypted Autobase replication with BlindPairing
  admission, signed Protomux presence, encrypted media/reports, canonical
  fixture projections, optional attested answers, record, receipt, and replay.

## Invariants

- Native Pear/Holepunch modules stay inside the Bare worker.
- A room/invitation/renderer cannot select or mint fixture authority.
- Durable actor authorization comes from the real Autobase source writer key.
- Feed time remains authoritative; MatchSync does not alter it.
- Browser `blob:` URLs enter replicated encrypted storage before durable use.
- Browser notification preferences are valid because Electron still owns the
  native presenter; the browser has no native module access.
- No credential, publisher key, gateway secret, or TxLINE setup belongs in a
  consumer desktop/browser launch path.

## Checks to run

    npm --workspace @fulltime/worker run typecheck
    npm --workspace @fulltime/worker test
    npm --workspace @fulltime/web run typecheck
    npm --workspace @fulltime/web run lint
    npm --workspace @fulltime/web run build -- --webpack
    npm --workspace @fulltime/desktop run check
    npm --workspace @fulltime/desktop test
    npm --workspace @fulltime/desktop run test:localhost
    FULLTIME_RUN_PEAR_INTEGRATION=1 npm --workspace @fulltime/desktop run test:integration

The loopback and DHT checks bind local sockets. A sandbox denial is an external
test gate, not authorization to add a mock transport.

## Remaining real boundaries

- Audio/video requires a real WebRTC transport, TURN credentials, and an SFU
  decision; no call surface should be shown before then.
- A production answer-attestor needs its own protected signing key, pinned
  publisher, receipt feed, and reachable public DHT path.
- `anchored` receipts require an independently pinned TxLINE anchor observer;
  until one exists, receipts honestly remain accepted/proof-pending.
- Forward read revocation requires an explicit room-epoch migration and
  re-pairing of remaining members.

See [PEAR-ROOMS-HANDOFF.md](PEAR-ROOMS-HANDOFF.md) for code-level ownership and
[operator deployment documentation](docs/operator-deployment.md) for signing,
HTTPS deployment, and key rotation.
