# Pear room architecture

## Topology

    FullTime operator
      -> TxLINE credentials -> persistent signed fixture publisher
      -> protected Ed25519 signer -> public HTTPS network manifest

    User desktop
      -> Electron -> DesktopPeerController -> Pear Runtime Bare worker
      -> private Next upstream -> loopback host -> Electron renderer / browser

The desktop fetches and verifies the manifest before creating its worker. It
caches only a verified manifest. Electron and a browser opened from Electron
share one worker and therefore one identity, Corestore, invite state, room
store, notifications, and event stream.

The browser host binds `127.0.0.1` only. It accepts a five-minute one-use
capability once, then requires its memory-only `HttpOnly; SameSite=Strict`
cookie and exact loopback origin for v2 requests/SSE. It sends no CORS headers
and clears sessions during Electron shutdown.

## Room model

- Every room has a creator bootstrap writer and a deterministic Hyperbee view.
- Membership is application-level, signed by room writers, and limited to 256
  active members; Hyperswarm permits at most 64 simultaneous direct peers.
- BlindPairing moves authenticated invitation material. Active members can
  serve signed admission claims while the creator is offline.
- Presence and typing are signed Protomux leases outside Autobase history.
- Media is encrypted in member Hyperblobs and reports are encrypted for the
  current staff recipient set.

Fixture snapshots, events, calls, settlements, and odds come only from the
manifest-pinned signed feed. With answer pins present, the worker verifies the
attestor response and exact receipt-feed block before a reference can affect a
room projection. `anchored` requires a future configured anchor observer; no
local fallback exists.

## Security notes

- Renderers never receive a room key, Corestore, socket, stream, native module,
  or device secret.
- Device identity seeds are sealed before persistence and opened only in the
  worker.
- Room operations use bounded schemas and deterministic validation.
- Attachment descriptors bind author, epoch, media core, nonce material, and
  plaintext hash.
- Removing a member blocks later writes but cannot erase history already
  downloaded; strong forward read revocation needs a new room epoch.

For code ownership and tests, see [PEAR-ROOMS-HANDOFF.md](PEAR-ROOMS-HANDOFF.md).
