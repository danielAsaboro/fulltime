import type { FixtureStatus, Team } from "@fulltime/shared";

import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";

function statusLabel(status: FixtureStatus, minute: number | null): { text: string; live: boolean } {
  switch (status) {
    case "first-half":
    case "second-half":
    case "extra-time":
      return { text: minute != null ? `${minute}'` : "LIVE", live: true };
    case "half-time": return { text: "HALF-TIME", live: true };
    case "end-of-regulation": return { text: "END REG.", live: true };
    case "penalty-shootout": return { text: "PENALTIES", live: true };
    case "full-time": return { text: "FULL-TIME", live: false };
    case "after-extra-time": return { text: "AET", live: false };
    case "after-penalties": return { text: "ON PENS", live: false };
    case "scheduled": return { text: "KICK-OFF SOON", live: false };
    default: return { text: status.replace(/-/g, " ").toUpperCase(), live: false };
  }
}

function TeamBlock({ team, align }: { team: Team; align: "left" | "right" }) {
  return (
    <div className={cn("min-w-0 flex-1", align === "right" && "text-right")}>
      <div className={cn("flex items-center gap-2.5", align === "right" && "flex-row-reverse")}>
        <Flag code={team.country ?? team.name} size={22} />
        <p className="truncate font-mono text-subheading font-medium uppercase tracking-[-0.02em] text-off-black">{team.shortName ?? team.name.slice(0, 3).toUpperCase()}</p>
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
  className,
}: {
  home: Team;
  away: Team;
  score: { home: number; away: number } | null;
  status: FixtureStatus;
  minute: number | null;
  className?: string;
}) {
  const { text, live } = statusLabel(status, minute);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-4">
        <TeamBlock team={home} align="left" />
        <p className="shrink-0 px-2 font-mono text-heading font-medium tabular leading-none text-off-black">{score ? `${score.home}–${score.away}` : "–"}</p>
        <TeamBlock team={away} align="right" />
      </div>
      <span className="inline-flex items-center gap-1.5 font-mono text-caption uppercase tracking-[0.1em] text-graphite">
        {live ? <span className="size-1.5 animate-pulse rounded-full bg-crimson" aria-hidden /> : null}
        {text}
      </span>
    </div>
  );
}
