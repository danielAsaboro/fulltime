/**
 * Snapshot recovery. After a reconnect (or on cold start) we rebuild a fixture's
 * state from the REST surfaces rather than trusting a partial stream:
 *   - GET /api/scores/snapshot/{fixtureId}  latest canonical state
 *   - GET /api/scores/updates/{fixtureId}   recent updates to replay in seq order
 * Feed both through the same normalize + FixtureMachine path as the live stream.
 */

import type { TxlineHttp } from "./http.js";
import type { TxScores } from "./types.js";

async function fetchScores(http: TxlineHttp, path: string): Promise<TxScores[]> {
  const body = await http.getJson<unknown>(path);
  if (Array.isArray(body)) return body as TxScores[];
  if (body && typeof body === "object") return [body as TxScores];
  return [];
}

export function fetchScoresSnapshot(http: TxlineHttp, fixtureId: string): Promise<TxScores[]> {
  return fetchScores(http, `/api/scores/snapshot/${fixtureId}`);
}

export function fetchScoresUpdates(http: TxlineHttp, fixtureId: string): Promise<TxScores[]> {
  return fetchScores(http, `/api/scores/updates/${fixtureId}`);
}
