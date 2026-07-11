/**
 * Honest receipt lifecycle projection.
 *
 * Acceptance is independently signed by the pinned answer attestor.  Settlement
 * is independently signed by the fixture publisher.  An anchor observer may
 * promote a settled receipt only after its external proof walk succeeds; this
 * pure projection never infers that result from the presence of an ID.
 */

import type { SettleOutcome } from "./settlements";

export type AcceptedReceiptState = "accepted" | "proof-pending" | "anchored" | "void";

export interface AcceptedReceiptStateInput {
  accepted: boolean;
  settlement: { outcome: SettleOutcome } | null;
  /** Set only by a configured, pinned observer after a successful proof walk. */
  verifiedAnchor: boolean;
}

export function projectAcceptedReceiptState(input: AcceptedReceiptStateInput): AcceptedReceiptState {
  if (!input.accepted) throw new TypeError("An unverified answer cannot have a receipt state");
  if (!input.settlement) return "accepted";
  if (input.settlement.outcome.status === "void") return "void";
  return input.verifiedAnchor ? "anchored" : "proof-pending";
}
