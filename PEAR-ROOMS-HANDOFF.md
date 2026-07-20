# Pear rooms — implementation handoff

## Physical three-device verification (2026-07-19)

Electron, a connected Infinix X683 (`061342509H000347`), and a connected
iPhone 12 Pro Max (`00008101-001035013468801E`) joined the same real room
`room_f307c05efd534701fbede8d28901180d`. Android and iPhone each wrote a unique
message through their native UI; both appeared in the desktop Autobase
projection. The iPhone Release XCTest completed successfully, and Android
reopened persisted encrypted room state after a force-stop/relaunch.

The physical iOS test must be built with `FULLTIME_MOBILE_PROFILE=local` after
`npm run mobile:configure:local`. `scripts/ios-physical-e2e.mjs` now refuses to
run unless the signed Release app's embedded Expo config contains the same
fixture feed key as the freshly verified local authority cache. This closes a
misleading failure mode where a correctly signed app silently exercised the
production publisher while the local replay used a newly generated feed.

`MobilePeerController` gives only `room.join` a 180-second bridge timeout. The
worker may legitimately use 60 seconds for an exact signed fixture snapshot,
45 seconds for BlindPairing, and 45 seconds to open durable membership. The
previous generic 60-second bridge bound could mask those precise worker-stage
errors. All other actions retain the 60-second request bound.

Final checks: mobile 18/18, desktop unit 91 passed with 12 explicit gates, real
desktop integration 5 passed with 2 explicit Pear-interop gates, plus complete
workspace typecheck, lint, and production build. The replay did not configure
an answer attestor; calls and settlements were projected, while receipts
correctly remained unavailable. Test teardown stopped the temporary authority,
Electron/Bare host, and Android process while retaining encrypted stores.

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

The web matchday entry at `apps/web/components/app-dashboard.tsx` is a renderer
projection only. Its live/next focus policy reads signed `fixture.list` data and
local `room.list` projections through the existing bridge; it does not move
fixture authority, native modules, or room creation into the browser.

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
source writer key rather than an authored user ID. Admitted active writers also
participate as Autobase indexers so any online member can durably admit the next
peer while the creator is offline. Indexer participation is transport state,
not a product role: creator and moderator authority remains reducer-enforced
from the authenticated source writer. An indexer serving an admission appends
an acknowledgement head after adding the writer, so the writer-set change is
committed before the signed claim is returned to the joining peer.

Fixture records, canonical calls, settlements, odds, and receipts require the
operator-pinned authorities. Social writers can reference those records but
cannot mint them. Feed timestamps determine ordering and lock presentation;
local wall clocks never authorize an answer. Browser `blob:` URLs are imported
into encrypted replicated storage before durable room operations.

Poll authors can attach one authenticated `market.reference` after a confirmed
Slip market creation. The operation stores only network, program, settlement
mint, market address, fixture identifier, canonical Rulebook hash, and creation
signature. Authorization is derived from the actual Autobase source writer and
requires that writer to be the original poll author; an identical retry is
idempotent and a conflicting replacement is rejected. Replicas never treat
copied odds, pools, results, or settlement state as authoritative. The normal
browser independently verifies the PDA, owner, mint, fixture, Rulebook hash,
and creation transaction through the packed public SDK before showing financial
controls, then reads and subscribes to current on-chain state directly.

The browser-only market flow uses Wallet Standard and a committed
`@slip/sdk@0.2.0` pack tarball with base-commit, working-tree patch, SHA-512, and
npm-integrity provenance in `vendor/`. It supports exact-label AI compilation,
review-before-signing, two-to-five outcomes, variable stakes, wallet tickets,
claims, refunds, proof receipts, and teardown-safe pool subscriptions. Electron
offers Open in browser; mobile and unsupported clusters do not expose money
controls. If market creation confirms but Autobase attachment fails, the exact
confirmed reference is retained locally for an idempotent retry.

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
    room.market.reference
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

The final July 14, 2026 archived-proof dogfood used these aggregate commands:

    npm run typecheck
    npm run lint
    npm run build
    npm --workspace @fulltime/worker test
    npm --workspace @fulltime/web test
    npm run desktop:test
    npm run test:slip:surfpool
    npm run desktop:test:integration

Typecheck, lint, and the production build passed. The focused suites passed 17
worker tests, 8 web tests, and 89 desktop tests (12 explicitly gated). The real
archived-root Surfpool lifecycle passed in 1.05 seconds. The real desktop
integration run passed attestation, same-peer Electron/normal-browser access,
encrypted Hyperblob replication, and the PearRuntime IPC boundary, but its
multi-peer room test timed out waiting for late-member admission replication.
A focused retry also failed, this time waiting for invite-rotation replication
despite both peers having three live connections and the same discovery key.
Those were real failures at that checkpoint, not mocked or skipped passes. The
focused lifecycle was fixed and rerun successfully on 2026-07-19; see the
current verification note below.

The packed SDK consumer contract imports only `@slip/sdk`; its default graph was
also loaded in isolation without sibling-repository access or server-only
modules. This is local/Surfpool evidence, not public-devnet evidence. Remaining
release gates are the unified devnet program upgrade, a real devnet
create/stake/read lifecycle, manual Wallet Standard dogfood, and a genuine
TxLINE fixture/proof walkthrough with activated credentials.

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

Local Android verification follows the same trust-root rule. `mobile:android`
bundles the worker for Android, links the actual room worker addons for arm64,
arm, x86, and x86_64, and builds a self-contained Release APK. The build checks
that the APK contains its Hermes bundle, Bare Kit runtime, and linked RocksDB
addon before copying it to the ignored local-development directory. Android 10
support pins `react-native-bare-kit` 0.14.5, the final official runtime compiled
for API 29 before 0.15.0 raised its native minimum to API 31. The build fails if
the runtime version or manifest changes and verifies that the final APK still
declares API 29. Device verification must exercise the real worker startup and
room boundary on the connected Infinix X683 rather than treating installation
alone as success.

Android renders edge to edge. The mobile root now provides
`react-native-safe-area-context`, and its normal, room, settings, thread, and QR
scanner surfaces consume those insets. Device verification must confirm visible
controls remain below the status bar and above the navigation area.

Product-surface logos in the Electron/local-host experience link to `/app`, not
the public marketing `/` route. The public site navigation keeps `/` as its home.
The root layout leaves `/` outside the peer data provider, so the deployed
marketing homepage never probes or gates on the desktop-only peer bridge.
Electron's one-use **Open in browser** capability redirects authenticated local
browser sessions to `/app`; it never drops them onto the marketing homepage.

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

The poll market path is a packed-SDK consumer, not a second protocol client.
`npm run test:slip:surfpool` passes the full local chain boundary:
clean binary capability detection, five-option creation, real Kit-backed Wallet
Standard signatures, multiple variable stakes, exact SPL vault totals, deadline
rejection, permissionless TxLINE V3 multiproof resolution, fee/tip and
proportional payout, losing and double-claim rejection, one-sided void, timeout
void, and refund. The test loads the archived terminal proof JSON verbatim and
installs the finalized devnet daily-root account bytes verbatim; it does not
generate a successful proof or root. The vendored SBF and packed SDK have
source/artifact provenance files.

The authenticated root artifact is
`../resources/fixtures/world-cup-2026/18213979-norway-vs-england/daily-scores-roots.20645.devnet.json`.
It is the JSON-RPC response at finalized devnet slot `476185731` for PDA
`EdJuEftTBNwXRWJpvYCziVxKT87qMDVu9V6HC7PwGffB`, owned by TxLINE program
`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`; its SHA-256 is
`6efeab8e775b0919f9ea2832986e47ac13a7eb32e326c0d4da8415a39c3738f`.
Its provenance sidecar records the RPC origin, commitment, slot, owner, and
capture time. The terminal proof's three explicit stat leaves and four indexed
multiproof siblings reconstruct its archived event-stat root exactly. TxLINE's
compressed-zero encoding in the earlier V2 first-confirmed-goal proof remains
undocumented, so that proof is not accepted as an expression witness.

Poll publication checks the authenticated fixture context, question, and exact
ordered labels once for each immutable poll/configuration key. Resolvable and
deterministically unresolvable decisions are then persisted without a timer;
provider, RPC, capability, and configuration errors are never negative-cached.
The poll CTA is **Back my stand**. Its compact modal presents one decision at a
time: outcome first, then 5/10/25 USDT presets plus a custom decimal stake and
the explicit signing action. Settlement explanation is a single-sentence info
popover and consumes no layout space. The author's first signature opens the
pool and the second places the selected real ticket. Only an attached reference
that every consumer independently verifies exposes the same outcome-first,
stake-second control to other members. On 2026-07-14 this UI change passed
`npm run typecheck`, `npm run lint`, `npm --workspace @fulltime/web test` (8/8),
and `npm --workspace @fulltime/web run build`. The first sandboxed build attempt
failed because Turbopack could not bind its temporary process port; the same
build passed outside that restriction. A verified market contributes no inline
pool grid, status, proof receipt, or ticket rows to the room card: the poll stays
primary, with only **Back my stand** opening the wager flow. Terminal result and
claim/refund details are likewise disclosed only through **View result**. Inside
the wager modal the room-poll question is the primary heading; action copy is
never used as the page title.

The real TxLINE research corpus is captured from the workspace root with
`node resources/scripts/capture-txline-world-cup.mjs`. As of 2026-07-14 it holds
104 scheduled fixtures, 102 started fixtures, 100 terminal fixtures, and the
complete 1,185-update Norway–England transcript under
`resources/fixtures/world-cup-2026/`. Two archived fixtures returned no score
records and remain explicit coverage gaps. The Slip settlement design and its
proof limitations are documented in
`resources/research/slip-txline-derived-markets/report.md`.

### Authenticated archived-match replay

The Norway–England desktop replay is a local test transport over the real
fixture plane, not a production data fallback. It reads the captured 1,185-row
TxLINE SSE archive, preserves source sequence and feed timestamps, converts the
historical wire casing at one explicit adapter, folds every row through the
production `FixtureMachine`, and appends the resulting snapshots/events to a
fresh publisher-signed Hypercore. Unconfirmed and discarded incidents never
become match events. The terminal fold is Norway 1–2 England with exactly three
confirmed goal events.

Surfpool cannot move its bank clock backwards to July 2026. The lifecycle uses
an honest affine replay clock: archived kickoff is mapped ten minutes after the
local run begins while preserving the policy intervals (entry close five
minutes before kickoff, resolution four hours after kickoff, void after 48
hours). `timeTravelToTimestamp` advances only forward. Proof timestamps,
fixture identifier, root-account bytes, and Merkle witnesses remain the
archived TxLINE values.

Run the replay publisher and isolated Electron profile in separate terminals:

```bash
npm run operator:replay
npm run desktop:replay
```

The publisher remains armed at the scheduled state so setup does not race a
timer. After creating the Norway–England room, poll, and any pre-match Slip
positions, begin the four-minute playback with:

```bash
npm run operator:replay:start
```

Every replay launch creates a fresh fixture-feed key and storage directory, so a
completed immutable log is never rewound or overwritten. The production live
operator remains a separate command and store.

The verified desktop run used room
`room_1f8c5d6b01d02b15ad950f751d47f7ee`, a five-option poll with labels `0`,
`1`, `2`, `3`, `4+`, and the real MBP Ollama compiler. Compilation preserved
those labels. A persistent FullTime play keypair is stored in a mode-0600 local
runtime record, funded with five SOL and 1,000 six-decimal settlement tokens,
and signs real Kit transactions. Privy remains installed but its provider path
is intentionally paused for this dogfood.
The live UI reached 1–2/full-time with source record `18213979:1184`, 36 signed
incidents, and seven match calls. Evidence is in
`evidence/desktop-rulebook-review.png`, `evidence/desktop-live-replay.png`,
`evidence/desktop-terminal-replay.png`, and `evidence/desktop-vote-wager.png`.
The last image (SHA-256
`5293190766e29b3ae3fe861f1591e6b39cd913c9e0f32c6e70d3d5d2793d1c1a`)
shows the durable room vote at 100% for `3`, the verified open market, a real
five-token pool on outcome `3`, the connected-wallet ticket, and its creation
proof signature. The program-level resolve/claim/refund path remains covered by
the passing archived-proof Surfpool lifecycle.

Start the persistent chain with `npm run slip:play-runtime`. It installs the
vendored SBF, real six-decimal mint, authenticated archived daily root, and the
persistent funded signer. Its 100ms event drain is required: without it,
external transaction events eventually backpressure the embedded Surfpool RPC.

### Native mobile poll parity

The native room poll now follows the same progressive-disclosure rule as the
web surface: the room question is the card's primary heading, each of the exact
ordered options shows its live vote share and the current user's selection, and
no market grid, proof receipt, ticket row, Rulebook dump, or money CTA is added
to the room feed. Native poll creation is capped at the protocol's two-to-five
option market range. After an independently verified `market.reference`, mobile
shows only **Back my stand**. The modal asks for the outcome first and then a
5/10/25 USDT preset or custom decimal stake. A mode-0600 generated play wallet
is persisted locally, funded through the real local Slip funding boundary, and
signs the actual Kit transaction; no placeholder transaction path exists.

Privy packages and native configuration remain installed, but the provider and
wallet runtime import are intentionally paused. Importing `@privy-io/expo` from
the current React Native entry pulled the Node `jose` `zlib` runtime into Metro
and made the real Android release bundle fail. Keeping the inactive runtime out
of the entry bundle lets the existing device-owned FullTime identity run while
preserving the Privy setup for later work. The Expo config also removes only the
inactive Apple Sign In entitlement generated by that installed package; the
existing development provisioning profile does not contain that entitlement.

Local device builds now accept either a running `txline-live` operator or a
running authenticated `txline-replay` operator. They still fetch the signed
HTTPS network manifest, verify its publisher signature, and embed that verified
cache; a stale runtime record or invalid manifest remains a hard failure.

On 2026-07-14 the Infinix X683 (`061342509H000347`) passed the real device path:
`npm run mobile:android` completed a Release build (`631` Gradle tasks; `76`
executed and `555` up to date), the resulting APK SHA-256 was
`b93aa1d3c9a493809ff4e9ff879a2a628158833f2751965ad3416d47e11b148f`,
`adb -s 061342509H000347 install -r
apps/mobile/.local-development/android/FullTime-local-release.apk` returned
`Success`, and the installed app was launched and exercised into the genuine
Norway–England replay room. `evidence/mobile-infinix-room-poll.png` records the
poll-first card; its SHA-256 is
`5e4adbd9cfefde3d11137bc461836e5b3ddcaf883ce04a8d44915b8698e27b21`.
The first Android build correctly failed at Metro while the inactive Privy
import exposed Node `jose/zlib`; the documented build is the subsequent clean
release after removing only that runtime import.

The current three-device dogfood checkpoint uses room
`room_ba651726980755a8468baa72c978f116`, fixture feed
`d17d4e6768481767bc8dd5c6eb7a817ed4ef840b56ea96a560ad3a1de77bc670`,
and the ordered poll labels `0`, `1`, `2`, `3`, `4+`. The poll author now starts
market creation automatically after the one cached resolvability check; there
is no review/create CTA. The confirmed market is
`9qfisPr9UvtKvgfeGjqaw9vrhwVQ8nbUycGm1WzwVgt4` under program
`8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw` and settlement mint
`ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh`. Desktop voted for `3`
and signed a real 10 USDT ticket on `3`; Infinix voted for `4+` and signed a
real 10 USDT ticket on `4+`. Android evidence is
`evidence/mobile-infinix-back-my-stand.png`,
`evidence/mobile-infinix-wager-outcomes.png`,
`evidence/mobile-infinix-wager-stake.png`, and
`evidence/mobile-infinix-signed-wager.png`.

The authenticated replay was armed until the real desktop and Android wagers
existed, then started with `npm run operator:replay:start`. Its existing process
chain was inspected and reused: PIDs `37173` -> `37184` -> `37202` -> `37220`;
no second publisher was launched. It reached Norway 1–2 England with 36 signed
incidents.
The persistent Slip play runtime remains active (two previously existing
processes, PIDs `29587` and `30719`, were inspected and not killed). The local
signed-fixture relay is PID `59095`, listening on `0.0.0.0:59638`; PID `84770`
is a duplicate process without the listening socket and was left untouched.
The real relay was probed from a fresh Corestore: pinned block zero decoded to
fixture `18213979` with feed length one.

The physical iPhone is not yet a successful third room member. The relay now
serves canonical Hypercore wire proofs generated from the genuine publisher
feed, and a fresh Corestore-to-Corestore proof test passes. On the physical
iPhone, `Hypercore.key(proof.manifest)` prints the exact pinned feed key
`d17d4e...bc670`, but Bare's native buffer identity comparison rejects those
equal bytes. Copying decoded fields into fresh `b4a` buffers and comparing the
computed manifest hex to the immutable signed pin did not clear native manifest
installation. The cutoff test failed with `Fixture proof manifest resolves to
d17d4e...bc670 instead of the pinned feed key`; its result is
`/tmp/fulltime-iphone-signed-pin-20260714.xcresult`. The signed build and
reversible local-peer archive test pass, but room join and the third wager are
not reported as complete.

The connected iPhone 12 Pro Max (`00008101-001035013468801E`, iOS `26.5.2`)
passed `npm run mobile:ios`: Xcode reported `BUILD SUCCEEDED`, signed
`com.txoddline.fulltime` with the existing Apple development identity and team
profile, installed the app through CoreDevice, and reported
`Launched application with com.txoddline.fulltime bundle identifier.` The
embedded iOS `main.jsbundle` SHA-256 was
`f12e2711c409c639af8f3e4dd91f587623f3b15b04733d2103f1294b4dc4fa68`.
The first iOS build failed honestly because the inactive generated Sign in with
Apple entitlement was absent from the profile; the passing run followed the
scoped entitlement suppression above.

Scoped checks passed on 2026-07-14: web tests (8/8), web typecheck, web lint,
web production build, mobile tests (8/8), mobile typecheck, desktop check,
desktop tests (89 passed, 12 explicitly gated, 0 failed), Slip SDK tests
(13/13), Slip typecheck, Slip lint, Slip build, the signed iPhone Release
`build-for-testing`, and the real archived-root Surfpool lifecycle. The full
real Pear integration run passed four tests, skipped two explicit gates, and
failed the three-peer room test once at admission-claim application during
rejoin. That historical failure was resolved on 2026-07-19 by waiting for the
admitted writer authorization before publishing the claim and making active
room writers Autobase indexers independently of their product role.

### Terminal two-device wager dogfood result

The persistent Surfpool market contained exactly two positions before
settlement: 10,000,000 token units on `3` and 10,000,000 on `4+`; the pool
snapshot and token vault agreed. `surfnet_timeTravel` advanced the same running
chain to the market's recorded `resolveAt`. The program then consumed
`scores.terminal-proof-v3.1-2-3-4-5.json` verbatim against the installed
finalized devnet daily-root account. Resolution signature:
`5SZ5t5vYA6t3s6EDEU5Fao7MYcFHzzLBQ2PPeehocCFiHHzLjcoJqAwSNrLANWP4vnym2LnH3m2zJNVSZtuHBW1Z`.
Outcome `3` won. Ticket
`4Tnb6CSkDHvaHB423NmiHE9zFKLwqJ3yn1FxxfxmT7nE` was claimed with signature
`3JzjZUpSDShXsCekYAp3sb6WHARgXQgGRf3HF5XZtEAZatV5duSy5iJmHeo2vi7tyFqjhZR5p2y8N6TUoJVV6vUf`.

`npm run test:slip:surfpool` passed 1/1 against the real SBF and authenticated
archived root. It covers market creation, multiple stakes, vault equality,
deadline rejection, permissionless resolution, proportional payout, fee/tip
routing, loser and double-claim rejection, void, and refund. The harness did
not generate a root or successful proof.

Android refreshes the independently verified market when its wager disclosure
opens. A resolved/voided market shows **View result**, the winning label, the
device wallet's tickets, and only an eligible claim/refund signing control. The
Infinix displayed `3 won`, `4+ · 10 USDT`, and `This stand did not win`.

The in-place Release update also exposed a real bounded-IPC defect: terminal
fixture cards reused one score object at two paths, which the room protocol
correctly rejected as a shared reference. The projection now copies its summary
score and has a `validateJson` regression assertion. Mobile home also retains a
successful encrypted-room result if the independent fixture-schedule request
fails. The room and wallet survived every `adb install -r` update.

Evidence and SHA-256:

- `evidence/mobile-infinix-live-replay.png` —
  `e3e89ab3742fe8e19550f78dcabe153e7ca2087b9ceb1158bcdf3e329e90336d`
- `evidence/desktop-live-replay-two-sided.png` —
  `9209f006453e2be601c371e2ed2884687a8b509245e981fee67ab5eaff347764`
- `evidence/desktop-terminal-settled.png` —
  `b26e947b8aed09019853507baaee6c90477d5850e2c19653b871c93f9f74f042`
- `evidence/mobile-infinix-real-settlement.png` —
  `02d6779271ea60cd6743f1c9a307e1e3a6b298808af07227ad076f8db07cd95c`

The final Android Release APK SHA-256 is
`f2248cc3fffc04d7ab049cd8eeaef75ada526ab78471aa2a372109f457bafa0f`.
`npm run mobile:android` passed with 631 Gradle tasks and the verified API 29
Bare Kit/native-addon checks; `adb ... install -r` returned `Success`.

Final verification after these changes:

- `npm test`: 44 shared, 2/3 attestor (one gated), 91/103 desktop
  (12 gated), 8 mobile, 8 web, and 17 worker tests passed; zero failures.
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed. The build
  produced the complete Next 16 production route set.
- `npm run test:slip:surfpool`: passed 1/1 against the real vendored SBF.
- `npm --workspace @fulltime/desktop run test:integration`: 3 passed, 2 gated,
  2 failed. The late-member case timed out with the late writer at length 88
  while the creator signed length remained 82. The separate Bare worker case
  reached an online peer connection but did not receive fixture `bare-fixture`
  before its test deadline. This records the 2026-07-14 aggregate run; it is not
  rewritten as a pass.
- Current 2026-07-19 focused verification:
  `FULLTIME_RUN_PEAR_INTEGRATION=1 node --test apps/desktop/test/room-manager.integration.test.js`
  passed 1/1 in 78.2 seconds against a real local HyperDHT testnet. It covers
  authenticated multi-writer replication, leave/rejoin with writer rotation,
  creator-offline admission by an ordinary member, creator restart, invitation
  rotation, old-invite rejection, late-member replication, and terminal invite
  shutdown. The separate Bare worker fixture deadline from the older aggregate
  run has not been rerun by this focused command and is not claimed fixed.

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

## Native chat links and natural wagers (2026-07-18)

- Web room feeds and threads render external URLs as links plus native preview cards. Generic cards
  are populated by the real `/api/link-preview` boundary, which fetches bounded Open Graph metadata
  only after public-DNS validation and rejects private/local destinations. X/Twitter status URLs use
  X's official `publish.x.com/oembed` response and `platform.twitter.com/widgets.js`; failures stay
  visible and retryable instead of falling back to invented metadata.
- Mobile room chat uses the same URL parsing contract. Generic metadata is requested from the
  configured FullTime web origin; X posts use a compact native card populated with the author and
  text returned by X's official oEmbed boundary and open in the system browser when tapped. This
  avoids an oversized or partially initialized widget surface on older Android WebViews.
- Web and mobile wager composers can submit only a natural-language question. Slip derives two to
  five outcomes, displays the exact hashed TxLINE Rulebook for review, then creates the real poll and
  Solana market. The mobile path signs with the device-local wallet and persists the poll/rulebook/
  market reference between attempts, so a failed Autobase attachment resumes without minting a
  duplicate market.
- The compiler receives the room's authenticated fixture projection (competition, teams, kickoff,
  and game state) when TxLINE's server schedule boundary is unavailable. It cannot supply a fixture
  ID, outcome proof, result, or publisher authority; those remain canonical room/Slip inputs.
- The packed Slip SDK provenance includes the natural-outcome compiler contract. A real local Ollama
  request for `Will both teams score? Yes or no.` produced a two-outcome hashed Rulebook; the
  real Surfpool lifecycle remains the settlement verification boundary.
- On the connected Android 10 device, that same question compiled through the configured gateway,
  displayed `No`/`Yes` without count-label rewriting, registered a signed market and opening ticket
  on local Surfpool, and attached the verified reference to encrypted Autobase history. Interrupting
  the first attachment proved the persisted recovery path reused the signed market instead of
  creating a duplicate. The web compiler proxy now allows the compiler's documented 180-second
  upper bound rather than aborting a valid local-model request at 35 seconds.
- The final Android Release build completed all 631 Gradle tasks, installed successfully on the
  Infinix X683, and visually rendered the compact X card and verified No/Yes market together in the
  persisted room. The final iOS Bare worker bundle also passed. Physical Apple deployment remains
  unverified because Xcode reported the available iPad and both iPhones offline on this host.
- Final verification for this change passed `npm test` (51 shared, 2 attestor plus 1 gated,
  91 desktop plus 12 gated, 14 mobile, 10 web, and 17 worker), repository-wide typecheck, clean web
  lint, the FullTime production build, the 1/1 packed-SDK Surfpool boundary, and Slip's complete
  4 bigint / 13 scripts / 16 SDK / 4 keeper / 7 web / 4 real Surfpool test matrix.

## Public application downloads (2026-07-19)

- The marketing homepage renders a **Get FullTime** section and download navigation only for
  platforms backed by a configured absolute HTTPS release URL. The operator boundary is
  `FULLTIME_DESKTOP_DOWNLOAD_URL`, `FULLTIME_IOS_DOWNLOAD_URL`, and
  `FULLTIME_ANDROID_DOWNLOAD_URL`; malformed, non-HTTPS, or credential-bearing URLs fail the
  production build instead of producing an unsafe link.
- The GitHub repository is public, and desktop/mobile consumer release configs now pin the live
  authority documented below. The current verified artifacts are published at
  `https://github.com/danielAsaboro/fulltime/releases/tag/v0.1.0-beta.2`; the Vercel production site
  at `https://www.usefulltime.xyz/` renders those exact macOS and Android asset URLs and links iPhone
  users to the real Xcode source-build path. The beta.2 GitHub asset digests match
  `release/SHA256SUMS`: macOS
  `0cbd9a22c12fdd8afc041b80c45a09ee5bf6a3bda2b3564af4be0c5a61c3d56e`, Android
  `d30380cadc94a34a5b0a5ee820ef2ac3b4176c09ab909e5aaf31add7bd996ae8`. The
  local-development APK remains outside that release boundary.

### Live release authority

- The live mainnet fixture publisher runs as the supervised `fulltime-operator.service` on the
  DigitalOcean host at `134.122.23.27`. Its publisher data and corpus are durable under
  `/opt/fulltime-operator/data`; operator keys and the minimal TxLINE environment are isolated under
  `/opt/fulltime-operator/secrets`. The service uses the existing Docker runtime under a 192 MiB
  memory cap and publishes through Hyperswarm without exposing TxLINE credentials.
- Caddy serves the signed manifest at
  `https://fulltime.134.122.23.27.nip.io/v1/network.json`. FullTime's manifest verifier accepted its
  Ed25519 signature and pinned fixture feed
  `20e63f5f9f5bb191a48f40c1167948b8998059b9ce384464913dece3d0f873d4`. Desktop and native release
  configs embed only that HTTPS endpoint, its public verification key, and—on native—the same
  verified signed manifest as an honest stale startup cache.
- The Android release signing identity is not stored in Git. Its root-only recovery copy is at
  `/opt/fulltime-operator/secrets/android-release/` on the DigitalOcean host. Preserve that identity
  for every direct APK update; rotating it would prevent installed copies from upgrading in place.

## Authenticated World Cup showcase rooms (2026-07-19/20)

- Generated showcase inputs live under `data/world-cup-2026/`; the workspace evidence under
  `../resources/fixtures/world-cup-2026/` remains untouched. Every completed seed names its raw
  authenticated archive and provenance and is replayed through the production fixture normalizer,
  publisher, answer attestor, Blind Pairing admission, and encrypted Autobase room operations. The
  personas are disclosed fictional room participants; fixture state, event time, calls, settlements,
  and receipts are restricted to what the signed capture proves.
- Seventeen rooms are complete and persisted: the first three tournament fixtures, USA–Paraguay,
  Qatar–Switzerland, Brazil–Morocco, Haiti–Scotland, Australia–Turkey, Germany–Curaçao,
  Netherlands–Japan, all four quarter-finals, France–Spain's semi-final, France–England's third-place match, and
  Spain–Argentina's final. The
  chronological corpus is `data/world-cup-2026/showcase-corpus.json`. The final archive was fetched at
  `2026-07-20T01:05:26.622Z`; its authenticated raw SSE contains 1,387 source records and terminal
  `game_finalised` sequence 1385. Its SHA-256 is
  `cd1efa51cd6f6d0b8acae88df69a14f2d32c248fa02791636ab70057c29b8e62`.
- Spain–Argentina exposed a production normalization defect: TxLINE status 5 is end of regulation,
  not necessarily terminal. Shared validation and the worker reducer now model `end-of-regulation`
  separately, map signed `game_finalised`/status 100 to `full-time`, and retain later extra-time phases.
  Archived red-card confirmations are also emitted exactly once. Production replay now proves the
  Argentina red card, 0–0 after regulation, Spain's one confirmed 106th-minute goal, discarded
  provisional goals, and the signed 1–0 final state without hand-authored fixture facts.
- USA–Paraguay fixture `17588396` is the first room added during the full-corpus continuation. Its
  provenance-valid archive contains 1,017 source records, five confirmed scoring events, and terminal
  `game_finalised` sequence 1018 proving USA 4–1 Paraguay. The earlier schedule entry `17588394` is not
  a played match: its provenance hashes verify, but its SSE is zero bytes and its snapshot and interval
  captures contain zero records. It is retained as immutable evidence and excluded from room creation
  rather than being turned into synthetic history. The USA–Paraguay seed contains 31 chronological
  actions, four canonical call answers, sourced pre-match positions, a poll, quotes, replies,
  reactions, archive-timed match beats, and right/wrong receipts; its real signed-fixture/attestor/
  pairing/Autobase integration passed in 64.6 seconds.
- Qatar–Switzerland fixture `17588308` is backed by a provenance-valid interval archive SHA-256
  `1f3be380f325a4dc286b9b2e9b0f3cad8993a27f37284998dd375499a4345244` with 984 source records and
  terminal `game_finalised` sequence 983. It proves Switzerland's 16th-minute penalty score state,
  Qatar's confirmed headed equaliser at 93:59, and the 1–1 final. The room contains 31 chronological
  actions and six answers across two settled canonical calls. Its first integration attempt correctly
  rejected an answer submitted four seconds after the goal call's 30-second lock; all three answers
  were moved inside the real post-confirmation window, and the full integration then passed in 95.7
  seconds. Kickoff calls voided by preserved archive gaps are not answered or rewritten.
- Brazil–Morocco fixture `17588386` is backed by 982 provenance-valid source records and terminal
  `game_finalised` sequence 982. Every captured artifact hash matches its sidecar provenance. Production
  replay proves Morocco's 20th-minute opening goal, Brazil's 31st-minute equaliser, the 1–1 half-time and
  terminal states, and settled kickoff and half-time calls; calls voided by preserved feed gaps are omitted.
  Its room has 32 chronological actions, seven attested answers, pre-match scoreline positions, a poll,
  replies, quotes, supported reactions, stoppage-time pressure, and exact-result/right-wrong receipts. The
  real signed publisher, Blind Pairing, Autobase, and answer-attestor integration passed after the room's
  join/pre-match timestamps were aligned to its actual kickoff order.
- Haiti–Scotland fixture `17588316` is backed by 960 provenance-valid historical records, a single
  confirmed Scotland goal at 27:56, and terminal `game_finalised` sequence 960 proving Haiti 0–1
  Scotland. Its seed has 36 chronological actions, nine answers across three settled canonical calls,
  clear-favourite and exact-score positions, a poll, supporter atmosphere, Haiti's four-corner
  second-half pressure, a socially sourced penalty grievance kept separate from fixture truth, and
  right/wrong receipts. The real signed fixture, Blind Pairing, encrypted Autobase, and attestor
  integration passed in 84.1 seconds.
- Australia–Turkey fixture `17926689` is backed by 1,054 provenance-valid historical records, two
  confirmed Australia goals, and terminal `game_finalised` sequence 1054 proving Australia 2–0
  Turkey. The room contains 39 chronological actions and twelve attested answers across four settled
  calls, with pre-match Turkey hype/overs positions contrasted against an exact 2–0 Australia call,
  VAR and half-time beats, the second goal, and preserved right/wrong receipts. The real signed
  fixture, Blind Pairing, encrypted Autobase, and attestor integration passed in 56.7 seconds.
- Germany–Curaçao fixture `17588318` is backed by nine provenance-valid captured artifacts. The
  production replay consumer parses 974 preserved interval records ending at sequence 994 and proves
  seven confirmed Germany goals, Curaçao's confirmed 20th-minute equaliser, and terminal Germany 7–1
  Curaçao; the separately derived analysis reports 994 historical sequence positions. The room has 58
  chronological actions: 13 messages, six replies, six quotes, seven supported reactions, a four-way
  poll with four votes, and 21 attested answers across seven settled canonical calls. Its central
  receipt arc contrasts public 3–0/5–0 and win-to-nil consensus with Maya's pre-match Curaçao-goal call
  and Amina's five-plus-margin poll vote. The first real integration correctly rejected one half-time
  answer at 35 seconds, beyond the signed call's 30-second lock; moving the six taps inside 8–28 seconds
  produced a complete signed-fixture, Blind Pairing, encrypted Autobase, and attestor pass in 81.4
  seconds. Calls voided by preserved feed gaps remain omitted.
- Netherlands–Japan fixture `17588305` is backed by nine provenance-valid captured artifacts. The
  production replay consumer parses 862 preserved interval records ending at sequence 881 and proves a
  0–0 half-time state, four confirmed second-half goals, Japan equalising twice, and the terminal 2–2;
  the derived analysis reports 881 historical sequence positions. Its 47-action room contains 11
  messages, six replies, six quotes, seven supported reactions, a three-way result poll with four votes,
  and 12 attested answers across four settled canonical calls. The narrative preserves the public viral
  pre-match 2–2 prediction through four score changes, exposes a Netherlands-clean-sheet rewrite attempt,
  and ends on the exact-score receipt. Kickoff and goal calls voided by preserved feed gaps are omitted.
  The real signed fixture, Blind Pairing, encrypted Autobase, and answer-attestor integration passed in
  67.0 seconds.
- The persistent provisioner ledger is
  `apps/desktop/.local-development/historical-showcase/rooms.json`; it contains protected invite
  material and must not be printed or committed. The provisioner's console summary now deliberately
  omits invite codes while the mode-0600 ledger retains them for device admission. All seventeen rooms
  were verified in the running desktop
  projection with `scripts/desktop-cdp.mjs`, then joined sequentially and verified on the physical
  Infinix X683 with `scripts/android-join-showcase.mjs` and
  `scripts/android-verify-showcase.mjs`. Android reported all seventeen expected fixture IDs from its own
  persisted room list. Nine signed physical-iPhone XCTest joins also passed individually, with result
  bundles under `evidence/physical-e2e/ios-showcase-*.xcresult`. The iPhone 12 Pro Max became paired and
  available after room sixteen, but the accumulated room-list XCTest timed out while enabling automation
  mode before the test body could run; the failure bundle is retained at
  `evidence/physical-e2e/ios-showcase-room-list-1784542336946.xcresult`. The iPad and iPhone XS remained
  unavailable, so no new iOS success is claimed.
- Cross-runtime proof replay now derives the expected Hypercore key from the serialized manifest and
  compares canonical hex values; it never relies on Node/Bare Buffer identity. Mobile startup also
  prefers a newer verified bundled manifest over an older verified device cache, preventing a stale
  authority pin from shadowing a valid app update. The Android local build forces Metro's release
  bundle task after regenerating its Bare worker so an old embedded worker cannot survive a rebuild.
- Desktop packaging now hard-excludes `.local-development` before Electron Packager traverses the app
  tree. This prevents active peer stores, invite ledgers, device identities, and transient Electron
  singleton files from entering or racing a public artifact. Packaging with the pinned live manifest
  URL/public key produced `release/FullTime-darwin-arm64` successfully, and the packaged standalone
  UI/loopback-host smoke test passed against that exact bundle. Nested package-manager `.bin` links are
  stripped from staged runtime dependencies so no absolute developer path enters the app and strict
  ad-hoc code-sign verification succeeds.
- The current Android release was built with the preserved release identity and verified with APK
  Signature Scheme v2; signer certificate SHA-256 remains
  `66c3bb39cb2c3a36ba5431c209e20570194120ce110aa0dd995043fea5de6407`.
  The temporary recovery copies were deleted after the build. Installing this artifact over the
  attached development-signed app correctly failed with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`; the
  device was not uninstalled or cleared, so its accumulated showcase state remains intact. Android
  invite automation now clears the Compose field to a verified empty value and enters long canonical
  invites as paced, prefix-checked chunks without retapping and relocating the horizontal cursor.
- A cold Android restart with eleven rooms exposed a real scale boundary: `RoomManager.open()` reopened
  persisted Autobase rooms serially and the mobile controller abandoned readiness after 60 seconds.
  Persisted rooms now reopen with bounded concurrency four, and mobile allows up to five minutes for a
  legitimate large-corpus cold start. The regenerated Bare worker was embedded in a local Release APK,
  installed in place without clearing data, and reached the room list in 32.3 seconds with eleven rooms.
  After Qatar–Switzerland joined, a second physical cold restart reached ready in 31.2 seconds and the
  verifier again observed all twelve fixture IDs. Brazil–Morocco admission then exposed a second scale
  boundary: bursty durable room projections caused the mobile UI to launch overlapping room, detail,
  history, fixture, and room-list reads until the controller's 128-request safety ceiling correctly
  rejected another join. Mobile projection revisions are now debounced and both home and room refreshes
  coalesce onto a single in-flight read set instead of weakening that ceiling. The corrected local Release
  APK installed in place, cold-started the prior twelve stores in 30 seconds, admitted Brazil–Morocco
  through live Blind Pairing, and verified all thirteen persisted fixture IDs. Haiti–Scotland then
  admitted through the same path; Android verified all fourteen room IDs and cold-started those stores
  in 36 seconds. The admission driver now retries the in-app back control during room refreshes and
  safely dismisses only the carrier `com.android.stk` promotion with `CANCEL` plus system Back, never
  selecting an offer or using Android Back for FullTime's internal navigation. It now also reads
  Android's input-method visibility before sending Back, so an already-hidden keyboard cannot
  background FullTime, and requires observable `Joining` or target-fixture state before starting its
  pairing timeout. Australia–Turkey admitted through that corrected path; all fifteen IDs verified and
  a cold start reopened them in 35 seconds. Germany–Curaçao pairing admitted the Android writer and
  replicated its membership, but the mobile bridge timed out while opening/projecting the new history.
  After the pending operation returned its precise timeout, a process-only restart reopened the admitted
  room from protected storage; the physical Release app then verified all sixteen fixture IDs without
  clearing or replacing any device data. Netherlands–Japan followed the same observable path: shared
  Autobase membership proved admission, the bridge returned its explicit projection timeout, and a
  process-only restart reopened the seventeenth room from protected storage. Android then verified all
  seventeen IDs without clearing or replacing device data.
- Verification during this handoff passed all 19 mobile tests, mobile typecheck, desktop syntax checks,
  14 focused fixture-proof/room-operation/projection tests, six authenticated archive/reducer tests,
  and the real four-room historical integration
  through signed fixture discovery, Blind Pairing, replicated Autobase operations, and attested receipts
  (`FULLTIME_RUN_PEAR_INTEGRATION=1 node --test apps/desktop/test/historical-room-seeder.integration.test.js`,
  469 seconds). A complete `npm test` also passed (51 shared, 2 attestor plus 1 gated,
  92 desktop plus 14 gated, 19 mobile, 18 web, and 24 worker), as did the complete workspace
  `npm run typecheck`, repository-wide `npm run lint`, and the full Next.js production build
  (rerun outside the sandbox because Turbopack requires a local worker port). The final room separately
  passed the real fixture/pairing/Autobase/attestor integration in 66 seconds; Germany–Curaçao separately
  passed the same boundary in 81.4 seconds; Netherlands–Japan passed in 67.0 seconds. The physical iPhone
  has not joined the final, USA–Paraguay, Qatar–Switzerland, Brazil–Morocco, Haiti–Scotland,
  Australia–Turkey, Germany–Curaçao, or Netherlands–Japan. This does not
  invalidate the nine retained per-room XCTest result bundles, but the seventeen-room accumulated assertion
  still needs a successful automation session with `scripts/ios-verify-showcase.mjs`.
