/**
 * Receipts — the visible proof layer. A receipt earns its checkmark only on a
 * verified walk (TxLINE stat-validation + root/anchor read). "proof-pending" is a
 * legitimate, honest state; we never fake a checkmark before proof exists (PRD §4.8).
 */

import type { FixtureId, MatchEventId, ReceiptId, UserId, CallId } from "./ids";
import type { SettleOutcome } from "./settlements";
import type { WallClock } from "./time";

export type ReceiptState = "settled" | "proof-pending" | "anchored" | "void";

export type ReceiptSubject =
  | { kind: "call"; callId: CallId; outcome: SettleOutcome }
  | { kind: "moment"; moment: "goal" | "red-card" | "penalty"; matchEventId: MatchEventId };

export interface ReceiptProof {
  /** TxLINE stat-validation reference. */
  statValidationRef?: string;
  /** Root read or anchor transaction reference. */
  anchorRef?: string;
  /** Human-openable link to the anchor/proof artifact. */
  anchorUrl?: string;
  verifiedAt?: WallClock;
}

export interface Receipt {
  id: ReceiptId;
  fixtureId: FixtureId;
  /** The fan whose call this receipt is for; null for a shared room moment. */
  userId?: UserId;
  state: ReceiptState;
  subject: ReceiptSubject;
  proof?: ReceiptProof;
  createdAt: WallClock;
  updatedAt: WallClock;
}

/**
 * The single guard behind the checkmark: a receipt may reach "anchored" only when
 * both stat-validation and an anchor/root reference are present. The anchor watcher
 * must route every upgrade through this.
 */
export function canAnchor(proof: ReceiptProof | undefined): boolean {
  return Boolean(proof?.statValidationRef && proof?.anchorRef);
}
