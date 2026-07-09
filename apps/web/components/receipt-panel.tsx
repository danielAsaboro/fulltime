"use client";

import { useState } from "react";

import type { ReceiptView } from "@/lib/data";
import { cn } from "@/lib/cn";
import { StatePill, type PillState } from "@/components/ui/state-pill";

const STATE_PILL: Record<ReceiptView["receipt"]["state"], PillState> = {
  settled: "settled",
  "proof-pending": "pending",
  anchored: "anchored",
  void: "void",
};

function fanExplainer(state: ReceiptView["receipt"]["state"]): string {
  switch (state) {
    case "anchored":
      return "This moment was checked against the match feed and matched the on-chain record. It's verified — nobody can fake it.";
    case "proof-pending":
      return "The moment is logged from the live feed. The final proof is still settling — we'll never show a checkmark before it does.";
    case "void":
      return "The feed had a gap across this window, so this can't be settled honestly. Void is the honest outcome.";
    default:
      return "Logged from the match feed.";
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ash py-2 last:border-0">
      <span className="font-mono text-caption uppercase tracking-[0.08em] text-smoke">{label}</span>
      <span className="truncate font-mono text-body-sm text-off-black">{value}</span>
    </div>
  );
}

export function ReceiptPanel({ view, className }: { view: ReceiptView; className?: string }) {
  const [open, setOpen] = useState(false);
  const { receipt, technical } = view;
  const hasProof = Boolean(technical.statValidationRef || technical.anchorRef);

  return (
    <div className={cn("rounded-card border border-ash bg-parchment p-6 sm:p-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          {view.minute != null ? (
            <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{view.minute}&apos;</p>
          ) : null}
          <h3 className="text-subheading text-off-black">{view.headline}</h3>
          {view.callPrompt ? (
            <p className="font-mono text-body-sm text-graphite">{view.callPrompt}</p>
          ) : null}
        </div>
        <StatePill state={STATE_PILL[receipt.state]} />
      </div>

      <p className="mt-4 font-mono text-body-sm text-graphite">{fanExplainer(receipt.state)}</p>

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-5 inline-flex items-center gap-2 font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black"
      >
        {open ? "Hide the proof trail" : "Show the proof trail"}
        <span aria-hidden className={cn("transition-transform", open && "rotate-180")}>↓</span>
      </button>

      {open ? (
        <div className="mt-4 rounded-lg border border-ash bg-periwinkle-mist/30 p-4">
          {technical.seq != null ? <Row label="Feed seq" value={String(technical.seq)} /> : null}
          {technical.statKey ? <Row label="Stat key" value={technical.statKey} /> : null}
          {technical.statValidationRef ? (
            <Row label="Stat validation" value={technical.statValidationRef} />
          ) : null}
          {technical.anchorRef ? <Row label="Anchor root" value={technical.anchorRef} /> : null}
          {!hasProof ? (
            <p className="py-2 font-mono text-body-sm text-smoke">
              Proof pending — no anchor to show yet. This is a legitimate state.
            </p>
          ) : null}
          {technical.anchorUrl ? (
            <a
              href={technical.anchorUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex font-mono text-body-sm text-lake-blue hover:underline"
            >
              Open the anchor →
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
