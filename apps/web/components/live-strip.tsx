"use client";

import Link from "next/link";

import { useFixtures } from "@/lib/data";
import { FixtureCard } from "@/components/fixture-card";
import { Skeleton } from "@/components/ui/primitives";

export function LiveStrip() {
  const fixtures = useFixtures("live");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-2 font-mono text-caption uppercase tracking-[0.12em] text-graphite">
          <span className="size-1.5 animate-pulse rounded-full bg-crimson" aria-hidden />
          Live now
        </p>
        <Link href="/matches" className="font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black">
          All matches →
        </Link>
      </div>

      {fixtures.status === "loading" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-card" />
          ))}
        </div>
      ) : fixtures.status === "error" ? (
        <p className="font-mono text-body-sm text-smoke">
          Couldn&apos;t reach the fixtures feed. The replay shows the full loop.
        </p>
      ) : fixtures.status === "empty" || !fixtures.data ? (
        <p className="font-mono text-body-sm text-smoke">
          No live matches right now — <Link href="/replay/9001" className="text-lake-blue hover:underline">watch the replay</Link> to
          see the whole room in action.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fixtures.data.map((card) => (
            <FixtureCard key={card.roomId} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
