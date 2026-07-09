# HANDOFF

Living state doc. A new engineer (or agent) should resume cold in under 5 minutes.
Update at every checkpoint: **state**, **decisions**, **next steps**, **open questions**.

Canonical spec: `internal/fulltime-prd.md`. Reference patterns only: `resources/fanswarm/`
(read for room/chat/reaction/poll modeling — never import, copy, or reference by name;
zero fanswarm/QVAC/Tether identifiers in this tree). Both dirs are gitignored.

---

## Current state — Phase 0 (scaffold) ✅ complete

- Monorepo initialized: npm workspaces, TypeScript throughout. Fresh git on `main`.
  - `apps/web` — Next.js 16 (App Router, TS, Tailwind v4, Turbopack), `@fulltime/web`.
  - `apps/worker` — TS worker run with `tsx`, `@fulltime/worker`; hosts the TxLINE spine.
  - `packages/shared` — framework-free domain model + pure logic, `@fulltime/shared`
    (ships raw TS; worker transpiles via tsx, web via Next `transpilePackages`).
- `packages/shared/src` domain modules (aligned 1:1 with PRD data tables):
  `ids, time, identity, fixtures, feed, events, odds, rooms, matchsync, calls,
  answers, settlements, receipts, scoring, social, market-says, records,
  highlights, realtime`. Pure helpers already implemented + tested: MatchSync
  release math (`time`), feed ordering/dedupe (`feed`), odds de-vig (`odds`),
  difficulty/points (`scoring`), fixture status predicates (`fixtures`).
- Root files: `.gitignore`, `.env.example`, `feedback.md`, `HANDOFF.md`, `README.md`,
  `tsconfig.base.json`, root `package.json` (workspace scripts + shared devtools).

**Verification (all green):** `shared` typecheck + 18 unit tests pass · `worker`
typecheck + boots (`npm run worker`) · `web` typecheck + `next build` succeed.

**Run it:** `npm install` → `npm run worker` (banner + missing-cred warnings) ·
`npm run web` · `npm run typecheck` · `npm test`.

## Key decisions

- **Package manager:** npm workspaces (no new tooling; Node 24 / npm 11 present).
- **shared ships TS source, not a build artifact.** Avoids a build-ordering step in
  a hackathon. Worker transpiles on the fly (`tsx`); web uses Next `transpilePackages`.
- **TS resolution:** `moduleResolution: "Bundler"` in `tsconfig.base.json` so hand-written
  source doesn't need explicit `.js` import extensions; `tsx` runs it as ESM directly.
- **Feed time is authoritative.** MatchSync (per-user delay) is presentation-only and
  never influences settlement. This is a hard invariant across worker + shared.
- **Corpus-first recorder.** Because TxLINE message schemas aren't published as
  JSON Schema, the recorder captures raw payloads on the wire first; normalized
  schema is locked from real data. Corpus feeds settle-engine tests + replay + demo.

## Next steps (in order)

- **Phase 1 — TxLINE spine (tonight-critical).** In `apps/worker`:
  1. Auth chain: `POST {origin}/auth/guest/start` → JWT; on-chain `subscribe`
     (devnet level 1 + mainnet level 12 realtime if activation allows); wallet-sign
     activation; `POST /api/token/activate`; every request carries
     `Authorization: Bearer <jwt>` + `X-Api-Token`; persist tokens; auto-refresh on 401.
  2. Fixtures loader (World Cup fixture ids, kickoffs, status map; shootout statuses
     11–13 are terminal).
  3. SSE clients for `/api/scores/stream` + `/api/odds/stream` (reconnect w/ backoff,
     message-id dedupe, heartbeat gap detection).
  4. **RECORDER** → `corpus/{net}/{fixtureId}.jsonl` (raw msg + received_at + feed ts)
     plus a normalized state-snapshot stream.
  5. Snapshot recovery: `/api/scores/snapshot/{fixtureId}` + updates search.
  - **Acceptance:** recorder writing live events during tonight's France–Morocco QF.
  - **CHECKPOINT:** show recorder output, update this file, commit. Stop for review
    before Phase 2 unless told to continue.

## Open questions / blockers

- **Credentials needed to run Phase 1 live:** a Solana keypair at
  `ACTIVATION_KEYPAIR_PATH` and confirmation that guest activation is permitted to
  subscribe to mainnet level 12 (realtime). Devnet level 1 is the fallback demo path.
- **Exact TxLINE message schemas** are unverified (no OpenAPI in the kit). Worker codes
  against the documented shape; recorder captures raw so we can lock schema from the wire.
- Supabase project not yet provisioned (Phase 2).
