import type { FanIqView as FanIqModel } from "@/lib/data";
import { cn } from "@/lib/cn";

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="min-w-0"><p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{label}</p><p className="font-mono text-subheading font-medium tabular leading-none text-off-black">{value}</p>{sub ? <p className="mt-0.5 font-mono text-caption text-smoke">{sub}</p> : null}</div>;
}

export function FanIqStrip({ iq, className }: { iq: FanIqModel; className?: string }) {
  const scored = iq.scoredCalls > 0;
  return (
    <div className={cn("grid grid-cols-3 gap-4 rounded-lg border border-ash bg-parchment px-5 py-4", className)}>
      <Cell label="Fan IQ" value={scored ? String(iq.fanIq) : "—"} />
      <Cell label="Accuracy" value={scored ? `${Math.round(iq.accuracy * 100)}%` : "—"} sub={scored ? `${iq.correctCalls}/${iq.scoredCalls}` : "no settled calls"} />
      <Cell label="Room rank" value={iq.roomRank > 0 ? `#${iq.roomRank}` : "—"} sub={iq.roomSize ? `of ${iq.roomSize}` : undefined} />
    </div>
  );
}
