# Pear rooms — implementation handoff

## Entry points

| Concern | Source |
| --- | --- |
| Electron shell and trusted renderer | `apps/desktop/electron/main.js` |
| One desktop-owned worker controller | `apps/desktop/lib/desktop-peer-controller.js` |
| Signed manifest verification/cache | `apps/desktop/lib/network-manifest.js` |
| Release trust-root loading | `apps/desktop/lib/release-config.js` |
| Loopback browser host | `apps/desktop/lib/local-host.js` |
| Private Next upstream | `apps/desktop/lib/web-upstream.js` |
| Bare worker entry point | `apps/desktop/workers/rooms.js` |
| Room lifecycle and IPC dispatch | `apps/desktop/workers/room-manager.js` |
| Autobase room model | `apps/desktop/workers/room.js` |
| Renderer bridge | `apps/web/lib/data/live/peer-bridge.ts` |
| Operator publisher and HTTPS manifest | `apps/worker/src/index.ts`, `apps/worker/src/network-manifest.ts` |
| Local operator development authority | `apps/worker/src/local-development.ts`, `apps/worker/scripts/start-local-live.cjs`, `apps/desktop/scripts/start-local-config.js` |
| Native mobile peer host | `apps/mobile/src/peer-controller.ts`, `apps/mobile/src/network-manifest.ts`, `apps/mobile/app/index.tsx` |

## Authority and startup

1. The FullTime operator owns TxLINE credentials, the persistent signed fixture
   publisher, answer-attestor/receipt pins, and a protected Ed25519 manifest
   signing key. The public HTTPS manifest is the only authority configuration
   accepted by a desktop.
2. A desktop release embeds only the manifest endpoint and verification public
   key. It fetches and verifies the manifest before creating its Pear worker.
3. The latest verified manifest is cached locally. A refresh failure uses that
   cache in visibly stale mode. With neither a fresh nor verified cached
   manifest, the local UI shows configuration unavailable and no room worker is
   started.
4. `DesktopPeerController` obtains the OS-protected device secret and starts
   exactly one `workers/rooms.js` process. It passes only manifest-derived
   public pins in worker arguments; the secret crosses the framed bootstrap
   message.
5. Electron preload IPC and `DesktopLocalHost` call the same controller. A
   normal browser cannot create a worker or identity. Electron grants it a
   one-use five-minute capability that exchanges for a memory-only
   `HttpOnly; SameSite=Strict` cookie.
6. The host binds only `127.0.0.1`, rejects unknown `Host` and `Origin` values,
   sends no CORS headers, validates v2 request frames, bounds SSE replay and
   subscriptions, and clears every browser session during Electron teardown.
7. The React Native mobile shell owns a separate device identity and Corestore
   in one Bare Kit worklet. It verifies the same operator manifest trust root,
   starts no peer without a verified fresh/cached manifest, and carries the
   desktop room core through the same framed v2 IPC boundary. `bare-pack` and
   `bare-link` package the real iOS native addons; the React Native thread never
   imports Corestore, Hyperswarm, Autobase, or TxLINE credentials.

## Room behavior

The Bare worker owns Corestore, Hyperswarm, BlindPairing, Autobase, Hyperbee,
Hyperblobs, signed Protomux presence, encrypted media, and notification state.
The renderer receives only serializable projected data through the validated
bridge. A room opens an encrypted Autobase; admission proves a peer identity
through BlindPairing; writer authorization is derived from the actual Autobase
source writer key rather than an authored user ID. When an Autobase indexer
serves an admission, it appends an acknowledgement head after adding the
writer, so the writer-set change survives an indexer restart before the signed
claim is returned to the joining peer.

Fixture records, canonical calls, settlements, odds, and receipts require the
operator-pinned authorities. Social writers can reference those records but
cannot mint them. Feed timestamps determine ordering and lock presentation;
local wall clocks never authorize an answer. Browser `blob:` URLs are imported
into encrypted replicated storage before durable room operations.

Browser notification settings are available because the browser calls the
Electron-owned worker and Electron retains the native notification presenter.
The browser never receives a native module or Electron preload object.

## Available renderer operations

    session.get / session.sign-in / session.sign-out
    fixture.list / fixture.get / fixture.intelligence / record.get
    room.get / room.preview-invite / room.create / room.join / room.details / room.state
    room.answer.submit / room.receipt.get / room.replay
    room.history.page / room.thread.page
    room.message.send / room.reply.send / room.poll.create / room.poll.vote / room.item.react
    room.media.upload.begin|chunk|commit|abort
    room.media.download.begin|chunk|close
    room.notification.settings / room.notification.settings.update
    room.report / room.reports.list
    room.typing.set / room.read.mark
    room.invite.create / room.invite.regenerate / room.invite.revoke
    room.rename / room.member.remove / room.member.role / room.slow-mode / room.close / room.leave

`notification.pending`, `notification.lifecycle`, and `system.close` are
desktop-internal actions and are not available through the browser host.

## Limits

- 256 active members per room.
- 64 direct Hyperswarm peers per worker.
- Room operation frames are bounded to 24 KiB; renderer/localhost JSON is
  bounded to 2 MiB.
- Media chunks are 256 KiB with two concurrent uploads and downloads; transfer
  sessions expire after 60 seconds.
- The loopback host retains at most 100 replayable events, 32 browser sessions,
  and two SSE streams per browser session.

## Verification

Run from `fulltime/`:

    npm --workspace @fulltime/shared run typecheck
    npm --workspace @fulltime/shared test
    npm --workspace @fulltime/worker run typecheck
    npm --workspace @fulltime/worker test
    npm --workspace @fulltime/web run typecheck
    npm --workspace @fulltime/web run lint
    npm --workspace @fulltime/web run build -- --webpack
    npm --workspace @fulltime/desktop run check
    npm --workspace @fulltime/desktop test
    npm --workspace @fulltime/desktop run test:localhost
    npm --workspace @fulltime/desktop run test:package-smoke
    FULLTIME_RUN_PEAR_INTEGRATION=1 npm --workspace @fulltime/desktop run test:integration
    npm --workspace @fulltime/mobile run typecheck
    npm --workspace @fulltime/mobile run test
    npm --workspace @fulltime/mobile run bundle:ios
    npm --workspace @fulltime/mobile run link:ios

The loopback/package/DHT commands require local socket binding. Do not replace a denied
sandbox run with a mocked DHT or browser bridge; report the environment gate.

For an explicit local operator setup, run `npm run operator:local-config` and
then `npm run desktop:local-config`. This is not a consumer fallback: it opens
the production signed publisher and serves a verified loopback manifest with
no synthetic fixture records.

When a repo-root `.env` has real TxLINE credentials, use
`npm run operator:local-live` before `npm run desktop:local-config`. The live
launcher supplies the credentials only to the operator, serves a locally
trusted HTTPS manifest, and forwards only `NEXT_PUBLIC_*` values to Electron.

For a real connected-iPhone run, start that same live operator and use
`npm run mobile:ios`. The local mobile build embeds an operator-signed public
manifest as a verified stale cache because the loopback HTTPS endpoint is not
the phone's loopback. Physical installation additionally requires an Apple
Developer account configured in Xcode; without it Xcode cannot create a
development provisioning profile. Simulator Release builds remain useful for
native/runtime verification but do not prove physical-device P2P networking.

The native room surface now calls the same worker actions as desktop for match
state and signed calls, chat and polls, paged threads and replies, encrypted
attachment import/download, member roles and removal, invite lifecycle, room
reporting, and the encrypted moderator report inbox. Attachments are selected
through the native document picker, imported into replicated encrypted room
storage before the durable message is committed, then decrypted and verified
by the Bare worker before a temporary native share copy is exposed. Mobile
notification controls remain absent until a real native notification presenter
owns their delivery lifecycle.

Mobile join-by-invite includes a native QR camera. It accepts the raw `ft2`
invite or the web UI's `/join/<invite>` URL, but does not trust the QR payload:
the scanned code is sent through `room.preview-invite` so the Bare worker parses
the blind-pairing invite and verifies its signed canonical preview before the
Join control is enabled.

Room state IPC projections must not reuse object identities across fields. In
particular, `state.polls` and `state.typingUsers` are independent JSON copies of
their canonical `state.items` and `state.members` entries; otherwise the v2
protocol correctly rejects the frame as containing shared references. Cursor
history and thread pages remain newest-first at the worker boundary and are
reversed only by each UI into chronological send order.

The live desktop room keeps the committed mock-era placement without restoring
mock behavior: Chat, Polls, and Room details remain the primary tabs; the
two-row header owns room identity, member avatars, score, and fixture status;
and signed calls, verified receipts, and the authoritative timeline live in the
collapsible desktop rail (or the equivalent mobile sheets). Poll indexing uses
the real local answer state and is labelled Open/Answered rather than inventing
a global poll-close state that the room protocol does not provide.

Worker bootstrap failure is bounded: if a partially opened Corestore hangs
during cleanup (notably after a peer-store lock conflict), the Bare worker exits
after two seconds. The desktop controller then rejects pending work as worker
unavailable instead of leaving a living IPC pipe that turns every action,
including `session.sign-in`, into a 60-second request timeout.

Product navigation now uses progressive disclosure. Electron opens the local
`/app` dashboard (rooms first, then focused Create/Join actions and a small
fixture preview) while the public `/` marketing page remains available in a
normal browser. Desktop rooms keep Chat, Polls, and Room as primary tabs; match
state stays in the right rail with calls prioritized and receipts/timeline
collapsed. Mobile keeps Chat, Polls, Match, and Room, but Home separates Join
and the two-step Create flow, Match initially shows current calls and three
recent events, and administrative/moderation/exit controls are collapsed.
Mobile poll creation edits individual options rather than parsing a comma list,
and composer attachments/polls are disclosed behind one action button.

An unreadable Electron `safeStorage` device-secret is never deleted or replaced
automatically because doing so would orphan the sealed peer identity. The local
UI reports the identity-lock condition separately from network configuration
and offers an explicit device reset. Reset archives the complete inaccessible
peer store, relaunches Electron, and creates a new Keychain-protected identity;
it is accepted only from the trusted Electron renderer while the controller is
in the protected-identity-unavailable state.

Electron permits sanitized clipboard writes only when both the requesting URL
and the owning window are the desktop-owned `127.0.0.1` renderer origin. All
clipboard reads, cross-origin writes, and unrelated browser permissions remain
denied by the session permission boundary.

Physical iPhone verification uses a signed Release build with Hermes
`main.jsbundle` embedded in `FullTime.app`. It must launch by bundle identifier
without a Metro or Expo script URL; a Debug install that depends on a packager
does not satisfy the mobile launch check. The device script builds Release with
`xcodebuild`, verifies the non-empty embedded bundle, then installs and launches
through `xcrun devicectl`; do not replace it with Expo's default Debug runner.
Local Release builds must run
`mobile:configure:local` and compile with `FULLTIME_MOBILE_PROFILE=local`;
otherwise Expo embeds the release configuration (which intentionally has no
consumer trust root) rather than the verified local operator manifest.

Product-surface logos in the Electron/local-host experience link to `/app`, not
the public marketing `/` route. The public site navigation keeps `/` as its home.

The desktop preload request allowlist includes `room.list`, matching the v2
worker protocol used by `/app`; dashboard room loading must not be rejected as
an unknown action. Invite QR surfaces show only the QR plus copy/share controls,
never the raw invite payload. The desktop match rail is ordered Timeline,
Receipts, then Match calls, and fixture scorelines resolve Norway and England
country aliases to their flags. Native releases carry a real opaque FullTime
app icon and render the matching brand mark beside the mobile wordmark.

Long signed blind-pairing invites require scan-safe QR rendering: product QR
surfaces use low error correction, a four-module quiet zone, and at least a
288px code. Do not shrink them back to the former 164px rendering; camera
decoders can return a partial payload that the worker correctly rejects. Mobile
detects incomplete `ft2` segment counts before IPC and asks the user to rescan.
After a verified scan, mobile retains the invite code only in component memory
and replaces all payload text with a room preview (name, competition, fixture,
member count) plus Join and Scan a different room actions.

Account settings are available from the top-right of product headers on web,
Electron, and mobile. Renaming calls `session.sign-in` and preserves the peer
identity. A rename is also appended as an authenticated `member.rename`
operation to every active local room, so replicas, member lists, presence, and
existing-item author projections resolve the new name while retaining the same
identity and actual Autobase writer authorization. Electron reset archives the complete peer store and relaunches;
mobile reset moves its peer directory to a timestamped archive, deletes only
the device identity secret, and remounts a fresh worker. Both resets require an
explicit destructive confirmation. Public localhost browser sessions omit the
reset control because they do not own the desktop lifecycle.

Local desktop restart is serialized against the exact peer-store owner. The
development launcher validates its recorded Electron PID, requests graceful
shutdown, and waits until no FullTime process still owns the `--storage` path
before spawning a replacement. Electron destroys localhost keep-alive sockets
before awaiting server closure, and the controller holds renderer requests
until the Bare worker emits its real `bridge.ready` after room restoration.
This prevents both Corestore lock races and startup requests being discarded.

## Do not regress

- Do not expose native Holepunch objects to the renderer.
- Do not add a per-browser Pear worker, browser session identity, or web gateway
  secret; both local surfaces must call `DesktopPeerController`.
- Do not let a room, invitation, renderer, or environment variable choose the
  fixture publisher for a consumer device.
- Do not fall back from an unavailable manifest to sample data or a local
  publisher.
- Do not put room state into a centralized database.
- Do not add a visual control or IPC action until its native backing operation
  exists and is verified.
