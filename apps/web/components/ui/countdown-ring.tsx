import { cn } from "@/lib/cn";

type Tone = "ink" | "accent" | "urgent";

const toneColor: Record<Tone, string> = {
  ink: "var(--color-off-black)",
  accent: "var(--color-lake-blue)",
  urgent: "var(--color-crimson)",
};

/**
 * Countdown ring. Presentational — parent passes `progress` (0 remaining → 1 full)
 * from a clock. Fixed box so it never resizes the card it sits in (PRD: rings
 * must not resize cards).
 */
export function CountdownRing({
  progress,
  center,
  size = 64,
  stroke = 4,
  tone = "ink",
  className,
}: {
  progress: number;
  center?: string;
  size?: number;
  stroke?: number;
  tone?: Tone;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-ash)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={toneColor[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 240ms linear" }}
        />
      </svg>
      {center !== undefined ? (
        <span className="absolute font-mono text-body-sm font-medium tabular text-off-black">
          {center}
        </span>
      ) : null}
    </span>
  );
}
