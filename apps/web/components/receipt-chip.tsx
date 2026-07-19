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

const STATE_LABEL: Record<AcceptedReceiptState, string> = {
  accepted: "Open accepted receipt",
  "proof-pending": "Open proof-pending receipt",
  anchored: "Open anchored receipt",
  void: "Open void receipt",
};

export function ReceiptChip({ state, roomId, receiptId }: { state: AcceptedReceiptState; roomId?: string; receiptId?: string | null }) {
  const pill = <StatePill state={STATE_TO_PILL[state]} />;
  if (!roomId || !receiptId) return pill;
  return (
    <Link
      href={roomReceiptHref(roomId, receiptId)}
      className="inline-flex min-h-10 items-center rounded-pill px-1 transition-opacity hover:opacity-80"
      aria-label={STATE_LABEL[state]}
    >
      {pill}
    </Link>
  );
}
