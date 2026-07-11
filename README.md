# FullTime

FullTime is an invite-only match-room application. Its rooms replicate through
Pear/Holepunch, encrypted Hypercore storage, Autobase, Hyperswarm discovery,
and BlindPairing admission. Fixture facts come from one operator-owned signed
publisher; room writers cannot mint fixtures, calls, settlements, or receipts.

## Use FullTime

Install and start the desktop app:

    npm install
    npm run desktop

The Electron app starts one local Pear worker, fetches and verifies FullTime's
public signed network manifest, and opens its local UI. Choose **FullTime →
Open in browser** to use the same local account and rooms in Chrome or another
browser on this machine.

There is no consumer setup for TxLINE, fixture feed keys, gateway secrets, or
publisher credentials. If FullTime cannot obtain a fresh manifest and has no
verified local cache, it shows a configuration-unavailable state and does not
start a room worker. A verified cached manifest remains usable offline and is
marked stale in the UI.

`npm run web:ui` is only a Next UI-development tool. It does not create a
publisher, a browser identity, or a consumer room service; peer access exists
only through the Electron-owned loopback host.

## Development checks

    npm --workspace @fulltime/shared test
    npm --workspace @fulltime/web run typecheck
    npm --workspace @fulltime/desktop test

Read [PEAR-ROOMS-HANDOFF.md](PEAR-ROOMS-HANDOFF.md) before changing peer-room
code. Operators should use [operator deployment documentation](docs/operator-deployment.md),
not consumer startup instructions.
