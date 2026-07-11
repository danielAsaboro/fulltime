"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useRoomReplay } from "@/lib/data";
import { CallCard } from "@/components/call-card";
import { EventFeed } from "@/components/event-feed";
import { MarketSaysCard } from "@/components/market-says-card";
import { PressureIndicator } from "@/components/pressure-indicator";
import { Scoreline } from "@/components/scoreline";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";

export function ReplayView({ roomId }: { roomId: string }) {
  const replay = useRoomReplay(roomId);
  const [position, setPosition] = useState<number | null>(null);
  const events = useMemo(() => replay.data?.timeline ?? [], [replay.data?.timeline]);
  const selectedIndex = position ?? Math.max(0, events.length - 1);
  const visibleEvents = useMemo(() => events.slice(0, selectedIndex + 1), [events, selectedIndex]);

  if (replay.status === "loading") return <Container className="py-12"><Skeleton className="h-80 w-full rounded-card" /></Container>;
  if (replay.status === "error") return <Container className="py-12"><ErrorState hint={replay.error ?? undefined} onRetry={replay.reload} /></Container>;
  if (replay.status === "empty" || !replay.data) {
    return <Container className="py-12"><EmptyState title="Room replay unavailable" hint="This replay requires the selected room and its verified fixture history on this device." /></Container>;
  }

  const data = replay.data;
  const feedTs = visibleEvents.at(-1)?.feedTs ?? null;
  const relevantCalls = data.calls.filter((item) => feedTs === null || Number(item.call.openedAt) <= Number(feedTs));

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo href="/app" />
          <Link href={`/room/${encodeURIComponent(roomId)}`} className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black">← Room</Link>
        </Container>
      </header>
      <Container className="py-12">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="max-w-3xl space-y-3">
            <p className="font-mono text-caption uppercase tracking-[0.14em] text-smoke">Signed room replay</p>
            <h1 className="text-heading text-off-black">The fixture timeline and this room’s verified answers.</h1>
            <p className="font-mono text-body-lg text-graphite">Replay follows publisher feed order. It does not delay, re-time, or fabricate a match moment.</p>
          </div>
          <section className="rounded-card border border-ash bg-parchment p-5">
            <Scoreline home={data.fixture.home} away={data.fixture.away} score={data.fixtureCard.score} status={data.fixtureCard.status} minute={data.fixtureCard.minute} />
            <div className="mt-6">
              <label className="flex items-center justify-between gap-4 font-mono text-caption text-smoke"><span>Signed event position</span><span>{events.length ? `${selectedIndex + 1}/${events.length}` : "No events"}</span></label>
              <input type="range" min={0} max={Math.max(0, events.length - 1)} value={selectedIndex} disabled={!events.length} onChange={(event) => setPosition(Number(event.target.value))} className="mt-2 w-full accent-[var(--color-lake-blue)]" />
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
            <section className="rounded-card border border-ash bg-parchment p-5"><h2 className="text-subheading text-off-black">Fixture timeline</h2><EventFeed events={visibleEvents} className="mt-3" /></section>
            <aside className="space-y-4"><PressureIndicator pressure={data.pressure} />{data.marketSays.map((card) => <MarketSaysCard key={card.id} card={card} />)}</aside>
          </div>
          <section className="space-y-4">
            <h2 className="text-subheading text-off-black">Canonical calls and room answers</h2>
            {relevantCalls.length ? <div className="grid gap-4 lg:grid-cols-2">{relevantCalls.map((call) => <CallCard key={String(call.call.id)} view={call} roomId={roomId} canSelect={false} attestationAvailable={data.receipts.length > 0} />)}</div> : <EmptyState title="No calls at this point" hint="Calls appear when their signed opening record enters the fixture timeline." />}
          </section>
          <Button href={`/room/${encodeURIComponent(roomId)}`} variant="ghost">Back to room</Button>
        </div>
      </Container>
    </div>
  );
}
