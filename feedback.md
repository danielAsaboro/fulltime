# TxLINE Feedback Log

Running log of every friction, ambiguity, and win we hit while integrating TxLINE.
This is a scored submission component — log from minute one, keep entries concrete.

Format per entry:

- **[date] surface — one-line title**
  - What we tried / expected.
  - What happened.
  - Where docs were unclear (link/section if possible).
  - Suggested improvement.

---

## 2026-07-09

- **[2026-07-09] docs — no machine-readable schemas in the integration kit**
  - Expected: request/response schemas (JSON Schema / OpenAPI) for `/auth/guest/start`,
    `/api/token/activate`, `/api/scores/stream`, `/api/odds/stream`,
    `/api/scores/snapshot/{fixtureId}` to code against.
  - Have: prose docs at https://txline.txodds.com/documentation/worldcup plus the
    endpoint hints in our own PRD. Field names/types must be discovered live.
  - Impact: worker is being written against a documented-but-unverified message shape;
    the recorder captures raw payloads first so we can lock the real schema from the wire.
  - Suggested improvement: publish an OpenAPI doc or sample JSONL per stream.
  - **Update:** an OpenAPI doc DOES exist at https://txline.txodds.com/docs/docs.yaml
    (v1.5.2) — it's just not linked from the World Cup page. Once found, schemas were
    complete. Suggest linking it prominently from the World Cup quickstart.

- **[2026-07-09] scores — status-code semantics differ from our brief**
  - Our brief stated "shootout statuses 11–13 are terminal." The soccer-feed docs
    define 11=WPE (waiting for penalties), 12=PE (shootout in progress),
    13=FPE (ended after penalties). Only 13 is terminal; 11/12 are live phases.
  - Impact: terminal detection maps 5 (F), 10 (FET), 13 (FPE) + 14–19
    (interrupted/abandoned/cancelled) to terminal; 11/12 stay live. Codes to be
    re-confirmed against the live wire tonight.

- **[2026-07-09] odds — Stable Price percentages are pre-demargined (a win)**
  - `OddsPayload.Pct[]` ships demargined percentages formatted to 3 dp (e.g.
    "52.632"), so difficulty + Market Says can read implied probability directly
    without de-vigging raw prices. `Prices[]` are int32 (scaling to confirm live).
  - Docs clear here; noting the useful field so downstream work leans on it.

- **[2026-07-09] ordering — the ordering key differs per stream**
  - Scores order by `seq` (int32, per fixture) with SSE `id` = "timestamp:index";
    odds order by `MessageId` (string). Both carry `Ts` (int64 feed time). Our
    recorder keys raw records by whichever the stream provides.

- **[2026-07-09] history — historical window is short**
  - `GET /api/scores/historical/{fixtureId}` covers ~2 weeks to 6 hours in the
    past. For a judge replay of tonight's match we must record the corpus live;
    we can't rely on pulling it back after the fact.
