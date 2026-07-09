import { cn } from "@/lib/cn";

/**
 * Ambient pressure. A quiet bar that fills with a warm decorative wash as the
 * match tightens — atmosphere, not a control. The label reads in mono; the colour
 * is decorative-only (Coral → Crimson), never a functional accent.
 */
export function PressureIndicator({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Pressure</span>
        <span className="font-mono text-caption tabular text-smoke">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-periwinkle-mist/60">
        <div
          className="h-full rounded-pill transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--color-coral), var(--color-crimson))",
          }}
        />
      </div>
    </div>
  );
}
