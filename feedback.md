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
