import type { PressureProjection } from "@fulltime/shared";

import { cn } from "@/lib/cn";

export function PressureIndicator({ pressure, className }: { pressure: PressureProjection; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, pressure.value)) * 100);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between"><span className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Pressure</span><span className="font-mono text-caption tabular text-smoke">{pct}%</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-periwinkle-mist/60"><div className="h-full rounded-pill transition-[width] duration-500" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--color-coral), var(--color-crimson))" }} /></div>
      <p className="font-mono text-[10px] text-smoke">Signed incidents {pressure.eventCount} · signed odds {pressure.oddsSnapshotCount}</p>
    </div>
  );
}
