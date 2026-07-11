import Link from "next/link";

import type { FixtureCard as FixtureCardModel } from "@/lib/data";
import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";
import { Tag } from "@/components/ui/tag";

function kickoffLabel(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

function TeamRow({
  code,
  name,
  country,
  score,
}: {
  code: string;
  name: string;
  country?: string;
  score?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        <Flag code={country} size={18} />
        <span className="font-mono text-body font-medium uppercase tracking-[0.02em] text-off-black">{code}</span>
        <span className="truncate font-mono text-caption uppercase tracking-[0.08em] text-smoke">{name}</span>
      </span>
      {score != null ? (
        <span className="font-mono text-body-lg font-medium tabular text-off-black">{score}</span>
      ) : null}
    </div>
  );
}

export function FixtureCard({
  card,
  className,
  href,
  callToAction,
}: {
  card: FixtureCardModel;
  className?: string;
  href?: string;
  callToAction?: string;
}) {
  const { fixture, phase, score, minute } = card;
  const home = fixture.home.shortName ?? fixture.home.name.slice(0, 3).toUpperCase();
  const away = fixture.away.shortName ?? fixture.away.name.slice(0, 3).toUpperCase();

  return (
    <Link
      href={href ?? `/matches?fixture=${encodeURIComponent(String(fixture.id))}`}
      className={cn(
        "group flex flex-col justify-between gap-4 rounded-card border border-ash bg-parchment p-6 transition-colors hover:border-off-black",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        {phase === "live" ? (
          <Tag tone="live" dot="live">
            {minute != null ? `${minute}'` : "Live"}
          </Tag>
        ) : phase === "finished" ? (
          <Tag tone="muted">Full-time</Tag>
        ) : (
          <Tag>{kickoffLabel(Number(fixture.kickoff))}</Tag>
        )}
        <span className="font-mono text-caption uppercase tracking-[0.08em] text-smoke">{fixture.competition}</span>
      </div>

      <div className="space-y-2">
        <TeamRow code={home} name={fixture.home.name} country={fixture.home.country} score={score?.home} />
        <TeamRow code={away} name={fixture.away.name} country={fixture.away.country} score={score?.away} />
      </div>

      <div className="flex items-center justify-between border-t border-ash pt-3">
        <span className="font-mono text-caption uppercase tracking-[0.08em] text-smoke">
          {callToAction ?? "Create a private room"}
        </span>
        <span className="font-mono text-body-sm text-off-black transition-transform group-hover:translate-x-0.5" aria-hidden>
          →
        </span>
      </div>
    </Link>
  );
}
