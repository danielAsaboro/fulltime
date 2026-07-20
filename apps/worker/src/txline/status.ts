/**
 * Soccer game-phase status codes → normalized `FixtureStatus`.
 *
 * Codes per TxLINE soccer-feed docs (re-confirm against the live wire):
 *   1 NS · 2 H1 · 3 HT · 4 H2 · 5 F · 6 WET · 7 ET1 · 8 HTET · 9 ET2 · 10 FET
 *   11 WPE · 12 PE · 13 FPE · 14–19 interrupted/abandoned/cancelled.
 *
 * NB: our brief called 11–13 "terminal"; the feed says only 13 (ended after
 * penalties) is — 11/12 are live shootout phases. Terminality is derived via
 * shared's `isTerminalFixtureStatus`, so it stays correct here (see feedback.md).
 */

import type { FixtureStatus } from "@fulltime/shared";

const STATUS_BY_CODE: Record<number, FixtureStatus> = {
  1: "scheduled",
  2: "first-half",
  3: "half-time",
  4: "second-half",
  // TxLINE code 5 marks the end of regulation. It is not terminal when the
  // competition proceeds to extra time; the signed game_finalised record is.
  5: "end-of-regulation",
  6: "extra-time",
  7: "extra-time",
  8: "extra-time",
  9: "extra-time",
  10: "after-extra-time",
  11: "penalty-shootout",
  12: "penalty-shootout",
  13: "after-penalties",
  14: "delayed",
  15: "abandoned",
  16: "cancelled",
  17: "abandoned",
  18: "abandoned",
  19: "abandoned",
  100: "full-time",
};

const CODE_LABEL: Record<number, string> = {
  1: "NS",
  2: "H1",
  3: "HT",
  4: "H2",
  5: "F",
  6: "WET",
  7: "ET1",
  8: "HTET",
  9: "ET2",
  10: "FET",
  11: "WPE",
  12: "PE",
  13: "FPE",
  100: "FINAL",
};

export function statusFromCode(code: number | null | undefined): FixtureStatus {
  if (code == null) return "unknown";
  return STATUS_BY_CODE[code] ?? "unknown";
}

/** Short feed label (NS/H1/…) for logs and the corpus audit trail. */
export function statusLabel(code: number | null | undefined): string {
  if (code == null) return "?";
  return CODE_LABEL[code] ?? `code:${code}`;
}
