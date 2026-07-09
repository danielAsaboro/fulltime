"use client";

import Link from "next/link";
import { useState } from "react";

import type { CalibrationMethod } from "@fulltime/shared";

import { useCalibration, useData, useRoom, useRoomState } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/tag";
import { CalibrationSheet } from "@/components/calibration-sheet";
import { CallCard } from "@/components/call-card";
import { EventFeed } from "@/components/event-feed";
import { FanIqStrip } from "@/components/fan-iq-strip";
import { MarketSaysCard } from "@/components/market-says-card";
import { PollCard } from "@/components/poll-card";
import { PressureIndicator } from "@/components/pressure-indicator";
import { ReactionBar } from "@/components/reaction-bar";
import { ReceiptChip } from "@/components/receipt-chip";
import { Scoreline } from "@/components/scoreline";
import { SignInModal } from "@/components/sign-in-modal";

export function RoomView({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const live = useRoomState(roomId);
  const calibration = useCalibration(roomId);
  const { client, session } = useData();

  const [signInOpen, setSignInOpen] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [localDelay, setLocalDelay] = useState<number | null>(null);

  const delaySeconds = localDelay ?? calibration.data?.delaySeconds ?? null;

  if (room.status === "loading" || (live.status === "loading" && !live.data)) {
    return <RoomSkeleton />;
  }
  if (room.status === "empty" || room.status === "error" || !room.data) {
    return (
      <RoomFrame>
        {room.status === "error" ? (
          <ErrorState hint={room.error ?? undefined} onRetry={room.reload} />
        ) : (
          <EmptyState
            title="Room not found"
            hint="This match room isn't open. Head back to the fixtures list."
            action={<Button href="/matches" variant="ghost" size="sm">See matches</Button>}
          />
        )}
      </RoomFrame>
    );
  }
  if (live.status === "error" || !live.data) {
    return (
      <RoomFrame>
        <ErrorState
          title="Feed reconnecting"
          hint={live.error ?? "Open calls are paused until the feed is back."}
          onRetry={live.reload}
        />
      </RoomFrame>
    );
  }

  const { fixture } = room.data;
  const state = live.data;
  const canParticipate = Boolean(session);

  const onSelect = (callId: string, option: string) => {
    if (!session) return setSignInOpen(true);
    void client.submitAnswer(roomId, callId, option);
  };
  const onSaveCalibration = (seconds: number, method: CalibrationMethod) => {
    setLocalDelay(seconds);
    void client.setCalibration(roomId, seconds, method);
  };

  const activeCalls = state.calls.filter((c) => c.call.status === "open" || c.call.status === "locked");
  const settledCalls = state.calls.filter((c) => c.call.status === "settled" || c.call.status === "void");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-ash bg-parchment/95 backdrop-blur">
        <Container className="py-3">
          <div className="mb-3 flex items-center justify-between">
            <Link
              href="/matches"
              className="font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black"
            >
              ← Matches
            </Link>
            {room.data.inviteCode ? <Tag tone="muted">Private · {room.data.room.name}</Tag> : <Logo href="/" />}
          </div>
          <Scoreline
            home={fixture.home}
            away={fixture.away}
            score={state.fixtureState.score}
            status={state.fixtureState.status}
            minute={state.fixtureState.minute}
            delaySeconds={delaySeconds}
            onCalibrate={() => setCalibrateOpen(true)}
          />
        </Container>
      </header>

      <main className="flex-1 pb-28">
        <Container className="grid gap-6 py-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <FanIqStrip iq={state.fanIq} />
              <div className="rounded-lg border border-ash bg-parchment px-5 py-4 sm:w-48">
                <PressureIndicator value={state.pressure} />
              </div>
            </div>

            {state.phase === "finished" ? (
              <div className="flex flex-col gap-3 rounded-card bg-periwinkle-mist p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-caption uppercase tracking-[0.12em] text-off-black/70">Full-time</p>
                  <p className="text-subheading text-off-black">Your Fan Report is ready.</p>
                </div>
                <Button href={`/room/${roomId}/report`} variant="primary" withArrow>
                  See report
                </Button>
              </div>
            ) : null}

            {activeCalls.length > 0 ? (
              <section className="space-y-3">
                <SectionLabel>Open calls</SectionLabel>
                {activeCalls.map((view) => (
                  <CallCard key={view.call.id} view={view} onSelect={(o) => onSelect(view.call.id, o)} />
                ))}
              </section>
            ) : null}

            {state.marketSays.length > 0 ? (
              <section className="space-y-3">
                <SectionLabel>Market says</SectionLabel>
                {state.marketSays.slice(-2).reverse().map((card) => (
                  <MarketSaysCard key={card.id} card={card} />
                ))}
              </section>
            ) : null}

            {state.polls.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                canVote={canParticipate}
                onVote={(option) => void client.votePoll(roomId, poll.id, option)}
              />
            ))}

            {settledCalls.length > 0 ? (
              <section className="space-y-3">
                <SectionLabel>Settled</SectionLabel>
                {settledCalls.map((view) => (
                  <CallCard key={view.call.id} view={view} onSelect={() => undefined} />
                ))}
              </section>
            ) : null}
          </div>

          <aside className="space-y-6">
            <section className="rounded-card border border-ash bg-parchment p-6">
              <SectionLabel>Timeline</SectionLabel>
              <EventFeed items={state.timeline} className="mt-3" />
            </section>

            {state.receipts.length > 0 ? (
              <section className="rounded-card border border-ash bg-parchment p-6">
                <SectionLabel>Receipts</SectionLabel>
                <ul className="mt-3 divide-y divide-ash">
                  {state.receipts.map((view) => (
                    <li key={String(view.receipt.id)} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0 truncate font-mono text-body-sm text-off-black">{view.headline}</span>
                      <ReceiptChip state={view.receipt.state} receiptId={String(view.receipt.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {state.notes.length > 0 ? (
              <section className="rounded-card border border-ash bg-parchment p-6">
                <SectionLabel>Room notes</SectionLabel>
                <ul className="mt-3 space-y-3">
                  {state.notes.map((note) => (
                    <li key={String(note.id)} className="font-mono text-body-sm text-graphite">
                      &ldquo;{note.text}&rdquo;
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </Container>
      </main>

      <footer className="sticky bottom-0 z-20 border-t border-ash bg-parchment/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <Container className="py-3">
          <ReactionBar
            canParticipate={canParticipate}
            onReact={(emoji) => void client.sendReaction(roomId, emoji, state.lastEventId ?? "room")}
            onNote={(text) => void client.sendNote(roomId, text, state.lastEventId ?? "room")}
            onRequireSignIn={() => setSignInOpen(true)}
          />
        </Container>
      </footer>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      <CalibrationSheet
        open={calibrateOpen}
        onClose={() => setCalibrateOpen(false)}
        initialSeconds={delaySeconds}
        onSave={onSaveCalibration}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">{children}</p>;
}

function RoomFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo />
          <Link href="/matches" className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black">
            Matches
          </Link>
        </Container>
      </header>
      <main className="flex flex-1 items-center">
        <Container className="py-16">{children}</Container>
      </main>
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-ash">
        <Container className="space-y-3 py-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-full" />
        </Container>
      </header>
      <main className="flex-1">
        <Container className="grid gap-6 py-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </Container>
      </main>
    </div>
  );
}
