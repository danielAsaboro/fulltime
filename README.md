# FullTime

Spoiler-safe, verified second-screen match rooms for the World Cup — powered by TxLINE.

> TxLINE turns live sports into verifiable state. FullTime plays it.

Every fixture gets a live room where fans watch together, react together, make
rapid-fire predictions ("calls") that settle deterministically from TxLINE feed
data, and leave with a Fan Report backed by verifiable receipts. The signature
feature, **MatchSync**, releases every room moment on each fan's own stream delay
so nobody gets spoiled.

Full product spec lives in `internal/fulltime-prd.md` (gitignored, private).

## Monorepo layout

```
fulltime/
├─ apps/
│  ├─ web/        Next.js (App Router, TS) — the match room UI + replay route
│  └─ worker/     TypeScript worker (tsx) — TxLINE spine: auth, SSE ingest,
│                 fixture state machines, settle engine, corpus recorder
├─ packages/
│  └─ shared/     Framework-free domain types + pure logic shared by web & worker
├─ .env.example   Required environment variables
├─ feedback.md    TxLINE integration friction log (scored submission component)
└─ HANDOFF.md     Living state doc — read this first when resuming cold
```

## Getting started

Requires Node >= 20 (developed on Node 24). Uses npm workspaces.

```bash
npm install                 # install all workspaces
cp .env.example .env        # then fill in Supabase + TxLINE + keypair values

npm run worker              # start the TxLINE ingest worker
npm run web                 # start the Next.js app (http://localhost:3000)
npm run typecheck           # typecheck every workspace
npm run test                # run workspace tests
```

## Architecture (one line each)

- **Worker** owns TxLINE: guest auth → subscribe/activate → scores + odds SSE →
  message-id-ordered fixture state machines → pure settle engine → corpus recorder.
  Feed time is authoritative; all settlement is pure and idempotent.
- **Web** is a mobile-first room: calibrate stream delay, answer call cards,
  react to verified moments, watch the timeline, collect receipts, get a Fan Report.
  A per-user release queue keyed to `feed_ts + delay` makes it spoiler-safe.
- **Shared** holds the domain model (rooms, calls, answers, settlements, receipts,
  records) and the pure functions both sides rely on, so logic can't drift.

See `HANDOFF.md` for current build state and what's next.
