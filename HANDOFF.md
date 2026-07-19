# FullTime handoff

## Physical desktop + Android + iPhone E2E (2026-07-19)

- A real Electron host, Infinix X683 Android 10 device
  (`061342509H000347`), and iPhone 12 Pro Max on iOS 26.5.2
  (`00008101-001035013468801E`) exercised the same encrypted room. The room is
  `room_f307c05efd534701fbede8d28901180d`; desktop created it, Android and iPhone
  were admitted through BlindPairing, and the desktop Autobase projection
  contains three active durable members.
- The standalone authenticated archive authority replayed the immutable Norway
  vs England capture for fixture `18213979`. A freshly relaunched authority was
  verified through its signed HTTPS manifest and published feed
  `58e8203149b11e6cb0f5462bf4bab0bfd2b6eb7cecb750564cac905ddfb66882`.
  The physical iPhone Release artifact was inspected before execution and
  confirmed to embed that exact verified local feed key.
- The terminal signed projection reached Norway 1–2 England with kickoff,
  corners, goals, half-time, substitutions, VAR, extra time, a yellow card,
  calls, and settlements. The capture has no configured answer attestor, so
  `attestationAvailable` is honestly false and no receipt was fabricated.
- Android sent `Hello from Android E2E`; iPhone sent
  `Hello from iPhone E2E`. Both messages were then read from the desktop's
  durable room projection. The final physical iPhone XCTest passed, and Android
  recovered its persisted encrypted room after force-stop/relaunch.
- Mobile `room.join` now has a 180-second outer IPC bound because its real
  internal bounds can total 150 seconds (verified fixture sync, BlindPairing,
  then durable membership open). Other mobile requests remain at 60 seconds.
- Physical-device build products, peer stores, screenshots, recordings, and
  `.xcresult` bundles remain local only. `/evidence/physical-e2e/` is now
  gitignored alongside the existing mobile/desktop `.local-development`
  directories. The small rerunnable control scripts remain source-visible.
  The installed local Android Release APK SHA-256 is
  `aabb3a768cf875650dfbd41599eace9affc33d2e79cb34abb70764da7527d162`.
- Normal teardown stopped the temporary replay authority, Electron host/Bare
  worker, and Android app process. Their persisted stores were retained.

Verification completed for this run:

    npm run mobile:test                         # 18 passed
    npm run desktop:test                        # 91 passed, 12 explicit gates
    npm run desktop:test:integration            # 5 passed, 2 explicit Pear interop gates
    npm run typecheck                           # passed
    npm run lint                                # passed
    npm run build                               # passed
    env FULLTIME_MOBILE_PROFILE=local xcodebuild -workspace apps/mobile/ios/FullTime.xcworkspace -scheme FullTime -configuration Release -destination id=00008101-001035013468801E -derivedDataPath apps/mobile/.local-development/ios-ui-test-derived-data -allowProvisioningUpdates build-for-testing -quiet
    node scripts/ios-physical-e2e.mjs            # passed on the physical iPhone

The first restricted integration attempt failed with UDX `EPERM`; it was
stopped and rerun with local socket permission, where all enabled real
HyperDHT/Corestore cases passed. This was an environment denial, not a mocked
or skipped transport result.

## Consumer matchday pass (2026-07-19)

- `/app` now leads with the real live or next signed fixture instead of a generic
  room directory. A live room belonging to the viewer takes priority over other
  live fixtures, so returning users resume the active social context in one tap.
- The hero exposes one dominant real action, an invite fast path, the current
  signed score when available, and the honest FullTime loop: follow the signed
  match, invite peers, answer only when signed calls are active, then retain the
  resulting receipt. It does not simulate a call or invent fixture data.
- Feed failure, no-fixture, loading, first-room, and returning-room states each
  have a specific explanation and next action. Finished fixtures never become a
  cold-start hero.
- Settled call cards now make the outcome legible at a glance (`You called it`
  or `Not this time`), surface Fan IQ as the payoff, and retain the receipt as a
  minimum-size keyboard/touch target. Proof language and receipt state remain
  unchanged and conservative.
- Native mobile keeps its device-identity onboarding, then moves the generic
  welcome/actions below a single real matchday hero. An active live room wins;
  otherwise the first live or earliest upcoming signed fixture becomes the
  setup action. Finished fixtures and mismatched room/fixture data never become
  the hero, and the empty state says the signed schedule is unavailable rather
  than fabricating a match.
- Selection policy is isolated in `apps/web/lib/matchday.ts` with deterministic
  coverage in `apps/web/test/matchday.test.ts`.
- The real multi-peer room lifecycle now completes across leave/rejoin, creator
  shutdown, ordinary-member admission, creator restart, invite rotation, stale
  invite rejection, late admission, and room closure. Admitted active writers
  participate as Autobase indexers, while all product authorization remains
  tied to the reducer's authenticated source writer. A joining peer waits for
  durable writer authorization before publishing its signed admission claim,
  preventing an unauthorized optimistic head from becoming stranded locally.

Verification for this slice:

    npm --workspace @fulltime/web test
    npm --workspace @fulltime/web run typecheck
    npm --workspace @fulltime/web run lint
    npm --workspace @fulltime/web run build -- --webpack
    npm --workspace @fulltime/desktop test
    npm --workspace @fulltime/mobile test
    npm --workspace @fulltime/mobile run typecheck
    FULLTIME_RUN_PEAR_INTEGRATION=1 node --test apps/desktop/test/room-manager.integration.test.js

Full workspace verification after the complete pass:

    npm test
    npm run typecheck
    npm run lint
    npm run build

All four commands passed. The focused real HyperDHT room lifecycle passed 1/1
in 78.2 seconds. Explicit credential/socket/package gates remain skipped by the
ordinary workspace test command and are not represented as passing.

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
- An authenticated poll author can compile the exact ordered 2–5 labels through
  Slip, review the canonical Rulebook, create a market through Wallet Standard,
  and attach the confirmed reference through the actual Autobase writer. Other
  members verify it independently before market reads or money controls appear.
- `vendor/slip.so` and `vendor/slip-sdk-0.2.0.tgz` are provenance-pinned. The
  separate `npm run test:slip:surfpool` command executes the packed SDK through
  FullTime's signing/send boundary against that real SBF and SPL Token program.

## Tim — room UI / marathon surface (2026-07-16)

- Shared pure projections: `projectMatchStory` and `projectCallStreak` (tests green).
- Room pulse: feed-backed match story card, latest Market Says, Fan IQ strip with
  streak + top-3 board, seed banter chips that fill the real composer (Autobase write).
- **Room radio (web + desktop + mobile) — social second screen, not stadium PA:**
  Product narrative is a peer-room booth (ambient second screen), not play-by-play
  PA and not “spoiler-safe” as the headline. Implementation still speaks only from
  already-visible room state (MatchSync release). Capabilities:
  - **Booth:** stands, polls, Market Says, released events with **odds-as-drama**
  - **Your book:** personal open stands / Fan IQ streak only
  - **Catch-me-up** on room join (score, room temperature, hottest market, last call)
  - House style: calm desk vs hype bench
  - Scripts: `packages/shared/src/match-voice.ts` (+ mobile mirror)
  - Web/desktop: `useRoomRadio` + `elevenlabs-consumer` + `POST /api/tts`
  - Consumer may paste their ElevenLabs key (device-local); host
    `ELEVENLABS_API_KEY` is builder-only via gitignored `.env.local`
  - Mobile: SecureStore key + direct ElevenLabs + `expo-av`
- **Peer UX parity (web + desktop loopback + mobile):** auto adjective-noun
  display names with reshuffle; deterministic geometric `PeerAvatar` on feed,
  threads, members, home, settings. Mobile: `apps/mobile/src/peer-*`,
  `author-style.ts`.
- Call cards use “Back your stand” framing; invite share copies challenge-style text.
- Tournament record share card copy improved on `/record`.
- Open Graph / Twitter cards point at compressed `/images/og.jpg`.
- Landing/marketing assets and multi-device evidence remain as previously dogfooded;
  iPhone third-peer join and public Slip money remain open (see remaining below).

### Verify before demo

    npm --workspace @fulltime/shared test
    npm --workspace @fulltime/web run typecheck
    npm --workspace @fulltime/web run build -- --webpack
    npm --workspace @fulltime/mobile run typecheck
    npm --workspace @fulltime/mobile test


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
    npm run test:slip:surfpool

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
- Public market controls remain hidden until the unified Slip binary is deployed
  and detected on the configured cluster. The July 14 devnet check returned false;
  no devnet lifecycle or genuine archived-proof claim is made here.

See [PEAR-ROOMS-HANDOFF.md](PEAR-ROOMS-HANDOFF.md) for code-level ownership and
[operator deployment documentation](docs/operator-deployment.md) for signing,
HTTPS deployment, and key rotation.
