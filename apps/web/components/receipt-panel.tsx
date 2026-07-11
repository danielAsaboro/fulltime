"use client";

import { useState } from "react";

import type { RoomReceiptView } from "@/lib/data";
import { cn } from "@/lib/cn";
import { StatePill, type PillState } from "@/components/ui/state-pill";

const statePill: Record<RoomReceiptView["state"], PillState> = { accepted: "accepted", "proof-pending": "pending", anchored: "anchored", void: "void" };

function explanation(state: RoomReceiptView["state"]): string {
  switch (state) {
    case "accepted": return "The pinned answer attestor accepted this answer and its signed receipt block has been verified. Settlement and anchor proof are still pending.";
    case "proof-pending": return "The accepted answer and publisher settlement agree. TxLINE anchor proof has not been verified, so FullTime does not show a checkmark.";
    case "anchored": return "A configured pinned anchor observer verified this receipt's external proof walk.";
    case "void": return "The publisher voided this call, so it has no score or anchor claim.";
  }
}

function Row({ label, value }: { label: string; value: string }) { return <div className="flex items-baseline justify-between gap-4 border-b border-ash py-2 last:border-0"><span className="font-mono text-caption uppercase tracking-[0.08em] text-smoke">{label}</span><span className="max-w-[65%] break-all text-right font-mono text-body-sm text-off-black">{value}</span></div>; }

export function ReceiptPanel({ receipt, className }: { receipt: RoomReceiptView; className?: string }) {
  const [open, setOpen] = useState(false);
  return <section className={cn("rounded-card border border-ash bg-parchment p-6 sm:p-8", className)}><div className="flex items-start justify-between gap-4"><div className="space-y-1"><p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Accepted answer</p><h3 className="text-subheading text-off-black">{receipt.callPrompt}</h3><p className="font-mono text-body-sm text-graphite">You chose {receipt.optionLabel}</p></div><StatePill state={statePill[receipt.state]} /></div><p className="mt-4 font-mono text-body-sm text-graphite">{explanation(receipt.state)}</p><button type="button" onClick={() => setOpen((value) => !value)} className="mt-5 inline-flex items-center gap-2 font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black">{open ? "Hide receipt details" : "Show receipt details"}<span aria-hidden>{open ? "↑" : "↓"}</span></button>{open ? <div className="mt-4 rounded-lg border border-ash bg-periwinkle-mist/30 p-4"><Row label="Receipt index" value={String(receipt.technical.receiptIndex)} /><Row label="Receipt feed" value={receipt.technical.receiptFeedKey} /><Row label="Attestor key" value={receipt.technical.servicePublicKey} /><Row label="Token" value={receipt.technical.tokenId} /><Row label="Call feed index" value={String(receipt.technical.callFeedIndex)} /><Row label="Fixture feed" value={receipt.technical.fixtureFeedKey} /><p className="pt-3 font-mono text-caption text-smoke">No anchor reference is displayed until a configured pinned observer verifies it.</p></div> : null}</section>;
}
