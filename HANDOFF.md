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
