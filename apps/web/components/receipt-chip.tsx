import Link from "next/link";

import type { AcceptedReceiptState } from "@fulltime/shared";

import { StatePill, type PillState } from "@/components/ui/state-pill";
import { roomReceiptHref } from "@/lib/receipt-link";

const STATE_TO_PILL: Record<AcceptedReceiptState, PillState> = {
  accepted: "accepted",
  "proof-pending": "pending",
  anchored: "anchored",
  void: "void",
};

export function ReceiptChip({ state, roomId, receiptId }: { state: AcceptedReceiptState; roomId?: string; receiptId?: string | null }) {
  const pill = <StatePill state={STATE_TO_PILL[state]} />;
  if (!roomId || !receiptId) return pill;
  return <Link href={roomReceiptHref(roomId, receiptId)} className="inline-flex hover:opacity-80" aria-label="Open room receipt">{pill}</Link>;
}
