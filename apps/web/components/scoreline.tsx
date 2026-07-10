import type { FixtureStatus, Team } from "@fulltime/shared";

import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";

function statusLabel(status: FixtureStatus, minute: number | null): { text: string; live: boolean } {
  switch (status) {
    case "first-half":
    case "second-half":
    case "extra-time":
      return { text: minute != null ? `${minute}'` : "LIVE", live: true };
    case "half-time":
      return { text: "HALF-TIME", live: true };
    case "penalty-shootout":
      return { text: "PENALTIES", live: true };
    case "full-time":
      return { text: "FULL-TIME", live: false };
    case "after-extra-time":
      return { text: "AET", live: false };
    case "after-penalties":
      return { text: "ON PENS", live: false };
    case "scheduled":
      return { text: "KICK-OFF SOON", live: false };
    default:
      return { text: status.replace(/-/g, " ").toUpperCase(), live: false };
  }
}

function TeamBlock({ team, align }: { team: Team; align: "left" | "right" }) {
  return (
    <div className={cn("min-w-0 flex-1", align === "right" && "text-right")}>
      <div className={cn("flex items-center gap-2.5", align === "right" && "flex-row-reverse")}>
        <Flag code={team.country} size={24} />
        <p className="truncate font-mono text-heading-sm font-medium uppercase tracking-[-0.02em] text-off-black">
          {team.shortName ?? team.name.slice(0, 3).toUpperCase()}
        </p>
      </div>
      <p className="mt-1 truncate font-mono text-caption uppercase tracking-[0.1em] text-smoke">{team.name}</p>
    </div>
  );
}

export function Scoreline({
  home,
  away,
  score,
  status,
  minute,
  delaySeconds,
  onCalibrate,
  className,
}: {
  home: Team;
  away: Team;
  score: { home: number; away: number } | null;
  status: FixtureStatus;
  minute: number | null;
  delaySeconds?: number | null;
  onCalibrate?: () => void;
  className?: string;
}) {
  const { text, live } = statusLabel(status, minute);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-4">
        <TeamBlock team={home} align="left" />
        <div className="shrink-0 px-2 text-center">
          <p className="font-mono text-heading font-medium tabular leading-none text-off-black">
            {score ? `${score.home}–${score.away}` : "–"}
          </p>
        </div>
        <TeamBlock team={away} align="right" />
      </div>

      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 font-mono text-caption uppercase tracking-[0.1em] text-graphite">
          {live ? <span className="size-1.5 animate-pulse rounded-full bg-crimson" aria-hidden /> : null}
          {text}
        </span>

        {onCalibrate ? (
          <button
            onClick={onCalibrate}
            className="inline-flex items-center gap-1.5 rounded-pill border border-ash px-2.5 py-1 font-mono text-caption uppercase tracking-[0.08em] text-graphite hover:text-off-black"
          >
            <span aria-hidden>⌁</span>
            {delaySeconds != null ? `+${delaySeconds}s` : "Set delay"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
