# BACKEND-REMAINING — for the next engineer (Codex)

The frontend is complete and runs on a **mock adapter**. Your job is to make it real by
filling one seam. **You should not need to touch any component or route.**

## The one integration point

Everything the UI reads or writes goes through a single interface:

- **Contract:** [`apps/web/lib/data/types.ts`](apps/web/lib/data/types.ts) → `FullTimeData`
- **Reference implementation (mock):** [`apps/web/lib/data/mock/`](apps/web/lib/data/mock/)
  — read this to see the exact shapes each method must return.
- **What you fill:** [`apps/web/lib/data/live/index.ts`](apps/web/lib/data/live/index.ts)
  — every method currently `throw`s with a `TODO(codex)` naming its table/channel.

Switch the app to your implementation with `NEXT_PUBLIC_DATA_MODE=live`. Until a method
is wired it throws, and the UI shows its **error state** (honest, not broken).

**Hard rule:** `apps/web/lib/data/live/` is the ONLY place Supabase (or any transport)
may be imported. No `@supabase/*` import anywhere else in `apps/web`.

View models are built from `@fulltime/shared` domain types; reuse them, don't redefine.
Odds arrive already de-vigged upstream (TxLINE `Pct[]`) — never de-vig in the app.

---

## 1. Live adapter methods → wiring + acceptance

All in [`apps/web/lib/data/live/index.ts`](apps/web/lib/data/live/index.ts). Return shapes
are in `types.ts`; the mock returns the canonical example for each.

| Method | Reads/Writes | Acceptance check |
|---|---|---|
| `listFixtures(filter)` | `fixtures` ⋈ global `rooms`; phase from status | `NEXT_PUBLIC_DATA_MODE=live` → `/matches` groups live/upcoming/finished from DB |
| `getFixtureCard(id)` | one `fixtures` row + its room | landing live-strip cards resolve |
| `getRoom(id)` | `rooms` ⋈ `fixtures`, `room_members` count | `/room/{id}` header shows teams + crowd |
| `getRoomByInvite(code)` | `rooms.invite_code` lookup | `/join/{code}` resolves the private room |
| `getRoomState(id)` | hydrate from `events`,`calls`,`answers`,`settlements`,`receipts`,`market_says`,`polls`,`notes` + viewer scoring | room renders timeline, calls, receipts on first paint |
| `subscribeRoomState(id,cb)` | **Supabase Realtime** channel `room:{id}`, diff payloads → rebuild `RoomLiveState`, `cb(state)`; return unsub | a goal inserted server-side pushes to open clients < 2s |
| `submitAnswer(room,call,opt)` | insert `answers` (wall-clock + feed-time + claimed delay) | tap an option → row inserted, tally updates via realtime |
| `sendReaction(room,emoji,anchor)` | insert `reactions` anchored to event | reaction fans out to the room |
| `sendNote(room,text,anchor)` | insert `notes` (≤120 chars, rate-limited) | note appears in room-notes |
| `votePoll(room,poll,opt)` | upsert `poll_votes` | tally updates |
| `getReceipt(id)` | `receipts` + proof artifact | `/receipt/{id}` shows state + proof drawer |
| `getReport(room)` | `settlements`/`records` for room+user | `/room/{id}/report` renders at FT |
| `getRecord()` | `records` for signed-in user | `/record` album populates |
| `getReplay(fixture)` | `replay_events` corpus → ordered beats | `/replay/{id}` dual-viewer plays |
| `getSession()` | SIWS session cookie/JWT → `users` | signed-in name shows in nav |
| `signIn(name)` | SIWS challenge → verify → session; upsert `users` | "Sign in" modal completes, session persists |
| `signOut()` | clear session | nav returns to "Sign in" |
| `getCalibration(room)` | `match_sync_profiles` for user+room | delay pill reflects saved value |
| `setCalibration(room,secs,method)` | upsert `match_sync_profiles` | delay persists across reload |

**Feed-time invariant:** `submitAnswer` must stamp both wall-clock and the viewer's
feed-time frontier + claimed delay. Delay is presentation-only and must NEVER influence
settlement (PRD §4.2). The mock records `feedTsAtAnswer` + `claimedDelaySeconds` — mirror it.

---

## 2. Supabase schema (PRD §5 data tables)

Model columns off the `@fulltime/shared` types (same names where possible). Suggested set:

- `users` (id, display_name, wallet_address, created_at) — address is an identifier, never surfaced.
- `fixtures` (id, competition, competition_id, home/away team json, kickoff_feed_ts, status, raw_status_code, minute, score json)
- `rooms` (id, fixture_id, type[global|private|judge], name, invite_code, created_by, created_at)
- `room_members` (room_id, user_id, display_name, role, joined_at)
- `match_sync_profiles` (user_id, room_id, delay_seconds, profile, method, calibrated_at)
- `events` (id, fixture_id, kind, feed_ts, message_id, minute, side, score json, detail) — worker `MatchEvent`
- `calls` (id, fixture_id, room_id, template, spec json, prompt, options json, opened_at, locks_at, settles_by, scored, status, difficulty)
- `answers` (id, call_id, user_id, option, submitted_at, feed_ts_at_answer, claimed_delay_seconds)
- `settlements` (id, call_id, outcome json, settled_at_feed_ts, deciding_message_ids)
- `polls` (id, room_id, question, options json, scored, anchor json, created_at) + `poll_votes` (poll_id, user_id, option)
- `reactions` (id, room_id, user_id, emoji, anchor json, feed_ts, created_at)
- `notes` (id, room_id, user_id, text, anchor json, feed_ts, created_at)
- `receipts` (id, fixture_id, user_id, state, subject json, proof json, created_at, updated_at)
- `records` (id, user_id, fan_iq, accuracy, matches_played, calls json, updated_at)
- `highlights` (id, room_id, fixture_id, kind, title, body, source_ids, created_at)
- `replay_events` (fixture_id, seq, feed_ts, payload) — the recorded corpus for replay

**Acceptance:** migrations apply; RLS lets a signed-in user read public rooms and write only
their own answers/reactions/notes; `SUPABASE_*` env from `.env.example` are consumed only in `live/`.

## 3. Realtime channels

- One channel per room: `room:{roomId}`, **diff payloads** (not full snapshots) — PRD §5.
- Map each diff to the shared `RoomDiff` union (`@fulltime/shared` `realtime.ts`) and fold into
  the current `RoomLiveState` inside `subscribeRoomState`.
- Document the low-thousands-per-room ceiling + a dedicated-websocket upgrade path.
- **Acceptance:** two browsers in the same room; an event/answer in one appears in the other < 2s.

## 4. Room provisioner

- One global room per fixture, created from the worker's fixtures loader.
- Private rooms via invite code; global tallies still render as ambient crowd in private rooms.
- **Acceptance:** every fixture in `/matches` has a resolvable global room; a generated invite
  code resolves at `/join/{code}`.

## 5. Settle + call engines → DB (worker, PRD Phase 3)

- Implement the pure settle functions per call template (`@fulltime/shared` `SettleFn`, `settlements.ts`);
  property-test against the recorded corpus (`corpus/` from the worker).
- Tempo-paced call scheduler (possession-state raises cadence; hard cap on concurrent open calls).
- Worker writes `calls`/`settlements` rows; realtime pushes `call.opened|locked|settled` diffs.
- **Acceptance:** replaying a corpus produces identical settlements every run; void paths
  (feed gap, abandonment, unresolved window, late answer) settle to `void`.

## 6. Scoring

- `@fulltime/shared` `scoring.ts`: points = base × `difficultyMultiplier(impliedProb)`; Fan IQ + accuracy;
  global rank needs `MIN_CALLS_FOR_GLOBAL_RANK`.
- Compute per-answer `AnswerScore`, aggregate into the room `FanIqView` and tournament `records`.
- **Acceptance:** a correct long-shot call scores more than a correct favourite; leaderboard shows
  Fan IQ and accuracy together.

## 7. Receipts + anchor watcher (worker)

- On settle/goal/red/penalty, create a `receipts` row (`state: proof-pending`).
- Anchor watcher polls TxLINE `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` +
  root reads; only when both verify does it upgrade to `anchored` — route every upgrade through
  `@fulltime/shared` `canAnchor(proof)`. Never fake a checkmark; `proof-pending` is legitimate.
- **Acceptance:** a receipt starts `proof-pending` and flips to `anchored` only after stat-validation
  + anchor refs are present; the `/receipt/{id}` proof drawer shows the refs.

## 8. SIWS server verification

- `signIn`: issue a challenge, verify the wallet signature server-side, mint a session
  (cookie/JWT), upsert `users`. UI copy stays "Sign in" — zero crypto vocabulary.
- **Acceptance:** `signIn`/`getSession`/`signOut` round-trip; session survives reload; the wallet
  address never appears in the fan-facing UI.

## 9. Replay backend

- `getReplay(fixture)` reads the recorded `replay_events` corpus and returns ordered `RoomLiveState`
  beats (mock builds ~10 beats; match that shape). The dual-viewer UI is already built.
- **Acceptance:** `/replay/{fixture}` scrubs through a real recorded match; the two delayed viewers
  reveal a goal at different points.

## 10. Worker → DB bridge

- The Phase-1 worker records `corpus/{net}/{fixtureId}.jsonl` and folds fixture state. Bridge those
  normalized snapshots + events into Supabase (`events`, `fixtures`, `replay_events`) and drive the
  room provisioner + call scheduler off the same stream.
- **Acceptance:** a live (or replayed) worker run populates the DB and a browser room updates from it.

## 11. Deploy (Railway)

- Web (`apps/web`, Next.js) + worker (`apps/worker`, tsx) as services; Supabase as data.
- Env: `SUPABASE_URL/ANON_KEY/SERVICE_KEY`, `TXLINE_*`, `ACTIVATION_*`, `NEXT_PUBLIC_DATA_MODE=live`.
- **Acceptance:** deployed URL serves a live room + the replay route; PWA installs (manifest at
  `/manifest.webmanifest`).

---

## Definition of done

`NEXT_PUBLIC_DATA_MODE=live` and the full loop works end-to-end: join → calibrate → open call →
goal (tally rolls, call settles, receipt pending → anchored ✓) → gap/void → full time → Fan Report →
record updated — with realtime fan-out and no mock imports in the running path.
