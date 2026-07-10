"use client";

import { useEffect, useState } from "react";

import type { CallView } from "@/lib/data";
import { cn } from "@/lib/cn";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { StatePill } from "@/components/ui/state-pill";
import { ReceiptChip } from "@/components/receipt-chip";

const WINDOW_SECONDS = 20;

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function CallCard({
  view,
  onSelect,
  canSelect = true,
  showReceipt = true,
  className,
}: {
  view: CallView;
  onSelect: (option: string) => void;
  canSelect?: boolean;
  showReceipt?: boolean;
  className?: string;
}) {
  const { call, tally, total, myAnswer, outcome, points, receiptId } = view;
  const open = call.status === "open";
  const selectable = open && canSelect;
  const settled = call.status === "settled";
  const isVoid = call.status === "void";
  const winning =
    view.settlement?.outcome.status === "settled" ? view.settlement.outcome.winningOption : null;

  // Countdown for an open call. The card is keyed by call id upstream, so each new
  // call mounts fresh at WINDOW_SECONDS; the interval only decrements (never a
  // synchronous setState in the effect body).
  const [left, setLeft] = useState(WINDOW_SECONDS);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [open, call.id]);

  const difficultyPct = call.difficulty != null ? Math.round(call.difficulty * 100) : null;

  return (
    <div
      className={cn(
        "rounded-card border bg-parchment p-6",
        settled ? "border-off-black animate-settle" : "border-ash",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-2 rounded-pill border border-ash px-2.5 py-1 font-mono text-caption uppercase tracking-[0.08em] text-smoke">
            {difficultyPct != null ? `${difficultyPct}% chance` : call.template}
          </span>
          <h3 className="text-subheading text-off-black">{call.prompt}</h3>
        </div>

        {open ? (
          <CountdownRing
            progress={left / WINDOW_SECONDS}
            center={String(left)}
            tone={left <= 5 ? "urgent" : "ink"}
          />
        ) : (
          <StatePill state={call.status === "locked" ? "locked" : isVoid ? "void" : "settled"} />
        )}
      </div>

      <div className="space-y-2">
        {call.options.map((option) => {
          const share = pct(tally[option.id] ?? 0, total);
          const mine = myAnswer === option.id;
          const won = winning === option.id;
          return (
            <button
              key={option.id}
              onClick={() => selectable && onSelect(option.id)}
              disabled={!selectable}
              className={cn(
                "relative w-full overflow-hidden rounded-lg border px-4 py-3 text-left transition-colors",
                mine ? "border-off-black" : "border-ash",
                selectable ? "hover:border-off-black" : "cursor-default",
                won && "border-off-black",
              )}
            >
              <span
                className="absolute inset-y-0 left-0 bg-periwinkle-mist/50"
                style={{ width: `${share}%` }}
                aria-hidden
              />
              <span className="relative flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 font-mono text-body text-off-black">
                  {mine ? <span className="size-1.5 rounded-full bg-off-black" aria-hidden /> : null}
                  {won ? <span aria-hidden>✓</span> : null}
                  {option.label}
                </span>
                <span className="font-mono text-body-sm tabular text-graphite">{share}%</span>
              </span>
            </button>
          );
        })}
      </div>

      {(settled || isVoid) && outcome ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ash pt-4">
          <div className="flex items-center gap-2">
            <StatePill state={outcome === "void" ? "void" : outcome} />
            {outcome === "correct" && points ? (
              <span className="font-mono text-body-sm font-medium tabular text-off-black">+{points} IQ</span>
            ) : null}
          </div>
          {outcome !== "void" && showReceipt ? (
            <ReceiptChip state="anchored" receiptId={receiptId} />
          ) : outcome === "void" ? (
            <span className="font-mono text-caption uppercase tracking-[0.08em] text-smoke">Feed gap</span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <p className="mt-3 font-mono text-caption text-smoke">
          {!canSelect ? "Calls are read-only right now." : myAnswer ? "Locked in — you can change it until the whistle." : "Tap to call it. Points scale with the odds."}
        </p>
      ) : null}
    </div>
  );
}
