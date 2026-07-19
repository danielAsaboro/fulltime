"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  MessageCircle,
  Radio,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";

import { useFixtures, useRooms, type FixtureCard } from "@/lib/data";
import { matchdayStatus, selectMatchdayFocus } from "@/lib/matchday";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { Flag } from "@/components/ui/flag";
import { Tag } from "@/components/ui/tag";

function teamLabel(card: FixtureCard, side: "home" | "away"): string {
  const team = card.fixture[side];
  return team.shortName ?? team.name;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-label="Loading your matchday">
      <Skeleton className="h-[420px] rounded-[24px] sm:h-[360px]" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-28 rounded-card" />
      </div>
    </div>
  );
}

export function AppDashboard() {
  const rooms = useRooms();
  const fixtures = useFixtures("all");
  const fixtureRows = fixtures.data ?? [];
  const roomRows = rooms.data ?? [];
  const focus = selectMatchdayFocus(fixtureRows, roomRows);
  const featured = [
    ...fixtureRows.filter((card) => card.phase === "live"),
    ...fixtureRows.filter((card) => card.phase === "upcoming"),
  ].slice(0, 3);

  if (fixtures.status === "loading" || rooms.status === "loading") return <DashboardSkeleton />;

  return (
    <div className="space-y-14 sm:space-y-16">
      <section aria-labelledby="matchday-title">
        {fixtures.status === "error" ? (
          <div className="space-y-5">
            <div>
              <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Your matchday</p>
              <h1 id="matchday-title" className="mt-2 text-heading text-off-black">Bring your people to the match.</h1>
            </div>
            <ErrorState
              title="The signed fixture feed is unavailable"
              hint={fixtures.error ?? "FullTime will not invent a schedule. Reconnect the verified Pear host and try again."}
              onRetry={fixtures.reload}
            />
            <Button href="/join" variant="secondary"><Ticket className="size-4" aria-hidden />Join with an invite</Button>
          </div>
        ) : focus.fixture ? (
          <MatchdayHero card={focus.fixture} roomId={focus.room ? String(focus.room.room.id) : null} liveCount={focus.liveCount} />
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-ash bg-off-black p-6 text-parchment sm:p-10">
            <p className="font-mono text-caption uppercase tracking-[0.12em] text-parchment/60">Your matchday</p>
            <h1 id="matchday-title" className="mt-3 max-w-2xl text-heading text-parchment">The next signed fixture has not arrived yet.</h1>
            <p className="mt-4 max-w-xl font-mono text-body-sm text-parchment/70">FullTime only creates rooms from the verified operator feed. You can still open an existing invite while the schedule refreshes.</p>
            <div className="mt-7"><Button href="/join" variant="primary"><Ticket className="size-4" aria-hidden />Join with an invite</Button></div>
          </div>
        )}
      </section>

      <section aria-labelledby="rooms-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Your rooms</p>
            <h2 id="rooms-title" className="mt-1 text-heading-sm">Back to your people.</h2>
          </div>
          <Button href="/join" variant="quiet" size="sm"><Ticket className="size-4" aria-hidden />Use an invite</Button>
        </div>
        <div className="mt-5 space-y-3">
          {rooms.status === "error" ? (
            <ErrorState title="Your rooms could not load" hint={rooms.error ?? undefined} onRetry={rooms.reload} />
          ) : roomRows.length ? (
            roomRows.map((room) => (
              <Link
                key={String(room.room.id)}
                href={`/room/${encodeURIComponent(String(room.room.id))}`}
                className="group flex min-h-24 items-center gap-4 rounded-card border border-ash bg-white/40 p-5 transition-colors hover:border-off-black focus-visible:border-off-black"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-periwinkle-mist"><LockKeyhole className="size-4" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate font-mono text-body-sm">{room.room.name}</strong>
                    {room.phase === "live" ? <Tag tone="live" dot="live">Live</Tag> : null}
                  </span>
                  <span className="mt-1 block truncate text-body-sm text-smoke">{room.fixture.home.name} vs {room.fixture.away.name} · {room.members} {room.members === 1 ? "member" : "members"}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-smoke transition-transform motion-safe:group-hover:translate-x-1" aria-hidden />
              </Link>
            ))
          ) : (
            <EmptyState
              title="Your first room starts with a real fixture"
              hint="Choose a signed match, name the room, then share its private invite. You can follow the match before anyone else arrives."
              action={<Button href={focus.fixture ? `/matches?fixture=${encodeURIComponent(String(focus.fixture.fixture.id))}` : "/matches"} variant="secondary">Choose a fixture</Button>}
            />
          )}
        </div>
      </section>

      {featured.length ? (
        <section aria-labelledby="fixtures-title">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Signed fixture feed</p>
              <h2 id="fixtures-title" className="mt-1 text-heading-sm">Live and next.</h2>
            </div>
            <Button href="/matches" variant="quiet" size="sm">All fixtures</Button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {featured.map((card) => (
              <Link
                key={String(card.fixture.id)}
                href={`/matches?fixture=${encodeURIComponent(String(card.fixture.id))}`}
                className="group rounded-card border border-ash bg-white/40 p-5 transition-colors hover:border-off-black focus-visible:border-off-black"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-caption uppercase tracking-[0.08em] text-smoke">{matchdayStatus(card)}</p>
                  {card.phase === "live" ? <span className="size-2 rounded-full bg-crimson motion-safe:animate-pulse" aria-label="Live" /> : null}
                </div>
                <p className="mt-5 text-subheading">{teamLabel(card, "home")} <span className="text-smoke">vs</span> {teamLabel(card, "away")}</p>
                <p className="mt-4 inline-flex items-center gap-1 font-mono text-caption text-graphite">Open setup <ArrowRight className="size-3.5 transition-transform motion-safe:group-hover:translate-x-1" aria-hidden /></p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MatchdayHero({ card, roomId, liveCount }: { card: FixtureCard; roomId: string | null; liveCount: number }) {
  const { fixture, score, phase } = card;
  const destination = roomId
    ? `/room/${encodeURIComponent(roomId)}`
    : `/matches?fixture=${encodeURIComponent(String(fixture.id))}`;
  const primaryLabel = roomId ? "Return to the live room" : phase === "live" ? "Start a room for this match" : "Set up this match room";

  return (
    <div className="overflow-hidden rounded-[24px] bg-off-black text-parchment">
      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
        <div className="relative min-h-[360px] p-6 sm:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(160,181,235,.28),transparent_38%),linear-gradient(135deg,transparent_55%,rgba(207,218,245,.08))]" aria-hidden />
          <div className="relative flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-3">
              <Tag tone={phase === "live" ? "live" : "muted"} dot={phase === "live" ? "live" : undefined}>{matchdayStatus(card)}</Tag>
              {liveCount > 1 ? <span className="font-mono text-caption text-parchment/60">{liveCount} signed fixtures live</span> : null}
            </div>
            <p className="mt-7 font-mono text-caption uppercase tracking-[0.12em] text-parchment/60">{fixture.competition}</p>
            <h1 id="matchday-title" className="mt-3 max-w-3xl text-heading text-parchment sm:text-heading-lg">
              {fixture.home.name} <span className="text-parchment/45">vs</span> {fixture.away.name}
            </h1>
            {score ? (
              <div className="mt-6 flex items-baseline gap-4 font-mono">
                <span className="text-[56px] font-medium leading-none tracking-[-0.06em]">{score.home}–{score.away}</span>
                <span className="text-body-sm text-parchment/60">from the signed feed</span>
              </div>
            ) : (
              <div className="mt-6 flex items-center gap-4">
                <Flag code={fixture.home.country} size={32} />
                <span className="font-mono text-body-sm text-parchment/60">Room history stays with its admitted peers.</span>
                <Flag code={fixture.away.country} size={32} />
              </div>
            )}
            <div className="mt-auto flex flex-col gap-3 pt-9 sm:flex-row">
              <Button href={destination} variant="primary" className="min-h-12 sm:min-w-56">{primaryLabel}<ArrowRight className="size-4" aria-hidden /></Button>
              <Button href="/join" variant="ghost" className="min-h-12 border-parchment text-parchment hover:bg-parchment hover:text-off-black"><Ticket className="size-4" aria-hidden />I have an invite</Button>
            </div>
          </div>
        </div>

        <div className="border-t border-parchment/15 bg-parchment/[0.06] p-6 sm:p-8 lg:border-l lg:border-t-0">
          <p className="font-mono text-caption uppercase tracking-[0.12em] text-parchment/60">The real matchday loop</p>
          <ol className="mt-6 space-y-5">
            <LoopStep icon={Radio} title="Follow the signed match" detail="Score, events, pressure and odds arrive from the pinned fixture publisher." />
            <LoopStep icon={Users} title="Bring your people" detail="Share one private invite. Messages and polls replicate between admitted peers." />
            <LoopStep icon={MessageCircle} title="Make your stand" detail="When signed calls are active, answer before the feed-authoritative lock." />
            <LoopStep icon={ShieldCheck} title="Keep the receipt" detail="Correct calls become verifiable room history; proof stays pending until independently anchored." />
          </ol>
          <p className="mt-7 flex items-start gap-2 border-t border-parchment/15 pt-5 font-mono text-caption text-parchment/60">
            <CheckCircle2 className="mt-px size-4 shrink-0 text-mint" aria-hidden />
            No wallet or publisher credentials are required to create a private social room.
          </p>
        </div>
      </div>
    </div>
  );
}

function LoopStep({ icon: Icon, title, detail }: { icon: typeof Radio; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full border border-parchment/20 bg-parchment/5"><Icon className="size-4" aria-hidden /></span>
      <span><strong className="block font-mono text-body-sm text-parchment">{title}</strong><span className="mt-1 block font-mono text-caption leading-relaxed text-parchment/60">{detail}</span></span>
    </li>
  );
}
