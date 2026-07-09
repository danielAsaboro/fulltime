import Link from "next/link";

import type { ReceiptState } from "@fulltime/shared";

import { StatePill, type PillState } from "@/components/ui/state-pill";

const STATE_TO_PILL: Record<ReceiptState, PillState> = {
  settled: "settled",
  "proof-pending": "pending",
  anchored: "anchored",
  void: "void",
};

export function ReceiptChip({
  state,
  receiptId,
}: {
  state: ReceiptState;
  receiptId?: string;
}) {
  const pill = <StatePill state={STATE_TO_PILL[state]} />;
  if (!receiptId) return pill;
  return (
    <Link href={`/receipt/${receiptId}`} className="inline-flex hover:opacity-80" aria-label="Open receipt">
      {pill}
    </Link>
  );
}
