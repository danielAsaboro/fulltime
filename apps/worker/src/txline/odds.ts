/**
 * Odds normalization. TxLINE's `Pct[]` is already de-vigged (Stable Price), so we
 * read the match-result (1X2) percentages straight into a shared `OddsSnapshot`,
 * deriving decimal odds as `100 / pct` for the difficulty/Market Says layers.
 * Non-1X2 markets and rows with an "NA" leg are skipped.
 */

import {
  asFeedMessageId,
  asFixtureId,
  type OddsSnapshot,
  type OutcomeKey,
} from "@fulltime/shared";
import { asFeedTimestamp } from "@fulltime/shared";

import type { OddsPayload } from "./types.js";

export function parseOddsData(raw: string): OddsPayload | null {
  try {
    return JSON.parse(raw) as OddsPayload;
  } catch {
    return null;
  }
}

function outcomeIndices(names: readonly string[]): Record<OutcomeKey, number> | null {
  const find = (re: RegExp): number =>
    names.findIndex((name) => re.test(name.trim().toLowerCase()));
  const home = find(/^(1|h|home|homewin|home win)$/);
  const draw = find(/^(x|d|draw|tie)$/);
  const away = find(/^(2|a|away|awaywin|away win)$/);
  if (home < 0 || draw < 0 || away < 0) return null;
  return { home, draw, away };
}

function pctToDecimal(pct: string | undefined): number | null {
  if (pct === undefined || pct === "NA") return null;
  const value = Number(pct);
  if (!Number.isFinite(value) || value <= 0) return null;
  return 100 / value;
}

/** Returns a 1X2 snapshot, or null if this payload isn't a usable full-match result market. */
export function normalizeOdds(payload: OddsPayload): OddsSnapshot | null {
  const names = payload.PriceNames;
  const pct = payload.Pct;
  if (!names || !pct) return null;

  const idx = outcomeIndices(names);
  if (!idx) return null;

  const home = pctToDecimal(pct[idx.home]);
  const draw = pctToDecimal(pct[idx.draw]);
  const away = pctToDecimal(pct[idx.away]);
  if (home === null || draw === null || away === null) return null;

  return {
    fixtureId: asFixtureId(String(payload.FixtureId)),
    feedTs: asFeedTimestamp(payload.Ts),
    messageId: asFeedMessageId(payload.MessageId),
    decimal: { home, draw, away },
  };
}
