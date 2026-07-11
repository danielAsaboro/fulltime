"use client";

import { useEffect, useState } from "react";

import type { RoomCallView } from "@/lib/data";
import { cn } from "@/lib/cn";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { ReceiptChip } from "@/components/receipt-chip";
import { StatePill } from "@/components/ui/state-pill";

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function usePresentationNow(view: RoomCallView): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (view.status !== "open") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [view.status, view.call.id]);
  return now;
}

export function CallCard({
  view,
  roomId,
  onSelect,
  canSelect,
  attestationAvailable,
  className,
}: {
  view: RoomCallView;
  roomId: string;
  onSelect?: (optionId: string) => Promise<void>;
  canSelect: boolean;
  attestationAvailable: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = usePresentationNow(view);
  const left = Math.max(0, Math.ceil((Number(view.call.locksAt) - now) / 1_000));
  const duration = Math.max(1, Number(view.call.locksAt) - Number(view.call.openedAt));
  const progress = Math.max(0, Math.min(1, (Number(view.call.locksAt) - now) / duration));
  const selectable = view.status === "open" && canSelect && attestationAvailable && Boolean(onSelect) && !view.myAnswer && !busy;
  const winning = view.settlement?.outcome.status === "settled" ? view.settlement.outcome.winningOption : null;
  const difficulty = view.call.difficulty != null ? `${Math.round(view.call.difficulty * 100)}% chance` : view.call.template;
  const statusPill = view.status === "open" ? "open" : view.status === "locked" ? "locked" : view.status === "void" ? "void" : "settled";

  const choose = async (optionId: string) => {
    if (!selectable || !onSelect) return;
    setBusy(true);
    setError(null);
    try {
      await onSelect(optionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Answer attestation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn("rounded-card border bg-parchment p-5", view.status === "settled" ? "border-off-black" : "border-ash", className)}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <span className="inline-flex rounded-pill border border-ash px-2.5 py-1 font-mono text-caption uppercase tracking-[0.08em] text-smoke">{difficulty}</span>
          <h3 className="text-subheading text-off-black">{view.call.prompt}</h3>
        </div>
        {view.status === "open" ? <CountdownRing progress={progress} center={String(left)} tone={left <= 5 ? "urgent" : "ink"} /> : <StatePill state={statusPill} />}
      </div>
      <div className="space-y-2">
        {view.call.options.map((option) => {
          const share = percent(view.tally[option.id] ?? 0, view.total);
          const mine = view.myAnswer?.optionId === option.id;
          const won = winning === option.id;
          const row = <><span className="absolute inset-y-0 left-0 bg-periwinkle-mist/50" style={{ width: `${share}%` }} aria-hidden /><span className="relative flex items-center justify-between gap-3"><span className="font-mono text-body text-off-black">{mine ? "● " : ""}{won ? "✓ " : ""}{option.label}</span><span className="font-mono text-body-sm tabular text-graphite">{share}%</span></span></>;
          const className = cn("relative w-full overflow-hidden rounded-lg border px-4 py-3 text-left", mine || won ? "border-off-black" : "border-ash");
          return selectable
            ? <button key={option.id} type="button" onClick={() => void choose(option.id)} className={cn(className, "hover:border-off-black")}>{row}</button>
            : <div key={option.id} className={className}>{row}</div>;
        })}
      </div>
      {view.myAnswer ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-ash pt-4">
          <div className="flex items-center gap-2">
            <StatePill state={view.myAnswer.outcome === "accepted" ? "accepted" : view.myAnswer.outcome === "void" ? "void" : view.myAnswer.outcome} />
            {view.points > 0 ? <span className="font-mono text-body-sm font-medium tabular text-off-black">+{view.points} IQ</span> : null}
          </div>
          <ReceiptChip state={view.myAnswer.receiptState} roomId={roomId} receiptId={view.myAnswer.receiptId} />
        </div>
      ) : null}
      {error ? <p className="mt-3 font-mono text-caption text-crimson">{error}</p> : null}
      {view.status === "open" && !view.myAnswer ? <p className="mt-3 font-mono text-caption text-smoke">{!attestationAvailable ? "Live calls need a configured pinned answer attestor." : !canSelect ? "Sign in and join the room to answer." : busy ? "Waiting for the signed attestor receipt…" : "The attestor decides the signed lock; this clock is presentation only."}</p> : null}
    </section>
  );
}
