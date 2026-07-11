import { cn } from "@/lib/cn";

export type PillState =
  | "open"
  | "locked"
  | "accepted"
  | "correct"
  | "incorrect"
  | "void"
  | "settled"
  | "pending"
  | "anchored";

const label: Record<PillState, string> = {
  open: "Open",
  locked: "Locked",
  accepted: "Accepted · proof pending",
  correct: "You called it",
  incorrect: "Missed",
  void: "Void",
  settled: "Settled",
  pending: "Proof pending",
  anchored: "Anchored",
};

const style: Record<PillState, string> = {
  open: "border border-ash text-off-black",
  locked: "bg-off-black text-parchment",
  accepted: "border border-ash text-off-black",
  correct: "border border-ash text-off-black",
  incorrect: "border border-ash text-graphite",
  void: "border border-dashed border-ash text-smoke",
  settled: "border border-ash text-graphite",
  pending: "border border-ash text-smoke",
  anchored: "border border-ash text-off-black",
};

const accent: Partial<Record<PillState, string>> = {
  accepted: "bg-lake-blue",
  correct: "bg-mint",
  anchored: "bg-mint",
  incorrect: "bg-coral",
};

export function StatePill({ state, children, className }: { state: PillState; children?: React.ReactNode; className?: string }) {
  const dot = accent[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-mono text-caption uppercase tracking-[0.08em]", style[state], className)}>
      {dot ? <span className={cn("inline-block size-1.5 rounded-full", dot)} aria-hidden /> : null}
      {state === "anchored" ? <span aria-hidden>✓</span> : null}
      {children ?? label[state]}
    </span>
  );
}
