# HANDOFF

Living state doc. A new engineer (or agent) should resume cold in under 5 minutes.
Update at every checkpoint: **state**, **decisions**, **next steps**, **open questions**.

Canonical spec: `internal/fulltime-prd.md`. Reference patterns only: `resources/fanswarm/`
(read for room/chat/reaction/poll modeling — never import, copy, or reference by name;
zero fanswarm/QVAC/Tether identifiers in this tree). Both dirs are gitignored.

---

## Current state — Frontend ✅ complete (mock-backed), backend handed off

The full frontend is built and runs on a **mock adapter** — landing through every
dashboard route. Backend work is documented in **`BACKEND-REMAINING.md`** for the next
engineer; do not start backend implementation from this doc.

**Design law:** `internal/design.md` + `internal/designrule.md` ("Monad" — editorial serif
+ mono on warm parchment, pill buttons, hairline borders, no shadows, Lake Blue = the single
CTA per screen). Tokens live in `apps/web/app/globals.css` (`@theme`); fonts are Newsreader
(serif) + JetBrains Mono via `next/font`. Motion only at the settle moment / brief eruptions.

**Data seam (the architecture):** `apps/web/lib/data/`
- `types.ts` — `FullTimeData`, the single interface every component consumes (over `@fulltime/shared`).
- `mock/` — default. Deterministic France–Morocco scenario engine (`scenario.ts`, 10 labelled
  beats: prematch → goal → settle → receipt anchored → void → penalty → FT) + corpus fixtures.
- `live/` — `TODO(codex)` stubs; the only place a transport may be imported.
- `provider.tsx` + `hooks.ts` — context, session, and `useFixtures/useRoom/useRoomState/…` hooks
  with uniform loading/empty/error envelopes. **No Supabase import anywhere in the app.**

**Routes (all with loading/empty/error):** `/` landing · `/matches` · `/room/[id]` (the product —
sticky sacred scoreline, open calls with countdown rings + live tallies, Fan IQ, pressure, Market
Says, reactions/notes/polls, inline receipts, FT→report rollover, one-thumb) · `/room/[id]/report`
· `/record` (album) · `/receipt/[id]` (proof drawer) · `/replay/[id]` (dual-viewer judge replay) ·
`/join/[code]` (guest preview) · `not-found` + root `error` boundary. SIWS modal (copy "Sign in",
zero crypto vocab) + quiet calibration sheet. PWA manifest + maskable icon.

**Verify:** `npm --workspace @fulltime/web run typecheck` ✓ · `run lint` ✓ · `run build` ✓
(10 routes; landing/matches/record static). All 9 routes return 200 at runtime.

**Run mock mode:** `npm run web` → http://localhost:3000. The France–Morocco room autoplays the
scenario; a bottom-right **Mock controls** panel (mock only) jumps to any labelled beat and forces
loading/empty/error on every route. `NEXT_PUBLIC_DATA_MODE=live` swaps in the (unfilled) live adapter.

**Frontend decisions:** followed the provided design guides as the visual law (a full design pass)
rather than invoking a design skill · `.js` import extensions stripped from `shared`/`web` relative
imports so Turbopack resolves the raw-TS shared package (Bundler resolution across the toolchain) ·
receipt/call state colour rides on small decorative accents (Mint = verified, Coral = missed), Lake
Blue stays the single CTA · mock writes are optimistic; odds mirror TxLINE's pre-demargined `Pct[]`.

---

## Current state — Phase 1 (TxLINE spine) ✅ built + verified offline

Phase 0 scaffold (monorepo, shared domain model, web) is done — see git history and
the shared module list below. Phase 1 built the worker's TxLINE spine end-to-end.

**Coded against the real OpenAPI spec** (`docs.yaml` v1.5.2, found at
`https://txline.txodds.com/docs/docs.yaml`), not guesses. `apps/worker/src`:
- `txline/types.ts` — exact wire shapes (Fixture, Scores/SoccerData/SoccerScore,
  OddsPayload, SSE envelopes). The documented boundary with the feed.
- `txline/auth.ts` + `txline/http.ts` — guest JWT + activate; every request sends
  `Authorization: Bearer <jwt>` + `X-Api-Token`; transparent refresh + retry on 401.
- `txline/activation.ts` — build the `${txSig}:${leagues}:${jwt}` binding, ed25519
  wallet-sign it (Node-native, Solana-compatible), exchange for the API token.
- `txline/fixtures.ts` — `/api/fixtures/snapshot` → normalized `Fixture[]`; find by teams.
- `txline/sse.ts` — generic SSE loop: backoff reconnect, `Last-Event-ID` resume,
  heartbeat-gap detection, event-id dedupe.
- `txline/scores.ts` + `txline/odds.ts` — normalize records; odds read TxLINE's
  pre-demargined `Pct[]` straight into de-vigged probabilities.
- `txline/status.ts` — game-phase code → `FixtureStatus` (see status note below).
- `state/fixture-machine.ts` — seq-ordered, idempotent fold → `FixtureState`,
  phase-transition events, feed-gap recording.
- `recorder/recorder.ts` — **RECORDER**: `corpus/{net}/{fixtureId}.jsonl`, raw
  (payload + received_at + feed ts) + normalized snapshots.
- `txline/snapshot.ts` — snapshot/updates recovery for reconnect rebuild.
- `ingest.ts` / `index.ts` / `demo.ts` — orchestration + an offline synthetic demo.

**Verification (all green):** 3 workspaces typecheck · 26 unit tests pass
(shared 18, worker 8) · **recorder proven offline** via `npm run worker -- --demo`
(synthetic France–Morocco feed → 10 raw + 10 snapshot records incl. goals, cards,
phase transitions, and a deliberate seq-gap captured as a `FeedGap`).

## Key decisions

- npm workspaces; **shared ships TS source** (no build step; tsx + Next `transpilePackages`).
- `moduleResolution: "Bundler"` so source needs no `.js` extensions; tsx runs ESM directly.
- **Feed time is authoritative; MatchSync is presentation-only.** Hard invariant.
- **Two ways in, token fast-path preferred.** Seed `TXLINE_JWT` + `TXLINE_API_TOKEN`
  (from the affiliate site / a prior activation) and the worker streams immediately.
  The on-chain `subscribe` tx is produced externally with a funded wallet; the worker
  does the wallet-signing + `/api/token/activate` given its `txSig`.
- **Ordering keys differ per stream:** scores by `seq` (namespaced `fixtureId:seq`),
  odds by `MessageId`. Both carry `ts`/`Ts` feed time.
- **Status codes** mapped in `status.ts`; only `13 FPE` (ended after penalties) is
  terminal among 11–13, not all three (brief was off here — logged in feedback.md).

## Next steps (in order)

1. **Go live (needs credentials — see below).** Set `.env` and run `npm run worker`.
   Confirm the wire matches `txline/types.ts`; fix any field/case drift and log it in
   feedback.md. Confirm the real World Cup `competitionId` and set `WORLDCUP_COMPETITION_ID`.
   Record tonight's France–Morocco QF into `corpus/`.
2. **Phase 2 — data + transport.** Provision Supabase; build the schema from the PRD
   tables; room provisioner (one global room per fixture); realtime channel-per-room
   diff fan-out. The shared types already map 1:1 to the tables.
3. **Phase 3 — the core** (settle engine over the corpus, call scheduler, scoring,
   social layer, Market Says, receipts + anchor watcher, replay, SIWS). Settle-engine
   tests run against the recorded corpus.

## Open questions / blockers

- **To run live-fire you need one of:** (a) a seeded `TXLINE_API_TOKEN` (+ optional
  `TXLINE_JWT`), or (b) `ACTIVATION_KEYPAIR_PATH` + `ACTIVATION_TX_SIG` from an on-chain
  `subscribe` run with a funded wallet, plus `TXLINE_LEAGUES`. Also confirm guest
  activation may subscribe to mainnet level 12 (realtime); else devnet level 1 (60s delay).
- **On-chain `subscribe` is produced outside this worker.** Building/sending that Solana
  tx (program IDL from `programs/*` + tx-on-chain repo) is not implemented here — the
  worker consumes its resulting `txSig`. Wire this in if we want fully in-worker subscribe.
- **Live schema drift:** types match the OpenAPI spec but haven't touched the live wire.
  First live run may surface field/case differences (esp. `statusSoccerId` object variant
  vs `dataSoccer.StatusId`, and `Prices[]` scaling). Recorder captures raw to reconcile.
- Supabase project not yet provisioned (Phase 2).
