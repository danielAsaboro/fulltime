"use client";

import { useFixtures, type FixtureCard as FixtureCardModel, type RoomPhase } from "@/lib/data";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { FixtureCard } from "@/components/fixture-card";

const GROUPS: { phase: RoomPhase; title: string; blurb: string }[] = [
  { phase: "live", title: "Live now", blurb: "Rooms are open and playing." },
  { phase: "upcoming", title: "Upcoming", blurb: "Rooms open ahead of kick-off." },
  { phase: "finished", title: "Full-time", blurb: "Match memories and reports." },
];

export function MatchesIndex() {
  const fixtures = useFixtures("all");

  if (fixtures.status === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-card" />
        ))}
      </div>
    );
  }
  if (fixtures.status === "error") {
    return <ErrorState hint={fixtures.error ?? undefined} onRetry={fixtures.reload} />;
  }
  if (fixtures.status === "empty" || !fixtures.data) {
    return (
      <EmptyState
        title="No fixtures yet"
        hint="When the World Cup schedule loads, every match gets a room here."
      />
    );
  }

  const byPhase = (phase: RoomPhase): FixtureCardModel[] => fixtures.data!.filter((c) => c.phase === phase);

  return (
    <div className="space-y-14">
      {GROUPS.map((group) => {
        const cards = byPhase(group.phase);
        if (cards.length === 0) return null;
        return (
          <section key={group.phase} className="space-y-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-heading-sm text-off-black">{group.title}</h2>
              <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{group.blurb}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <FixtureCard key={card.roomId} card={card} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
