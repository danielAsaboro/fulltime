"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Fixture } from "@fulltime/shared";

import { useReplay, type RoomLiveState } from "@/lib/data";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/state-pill";
import { Tag } from "@/components/ui/tag";
import { Scoreline } from "@/components/scoreline";

// Viewer B's stream is further behind, so it trails the leading edge by ~a beat.
const LAG_A = 0;
const LAG_B = 1.2;
const STEP = 0.04;
const TICK_MS = 130;

function clampIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function ViewerPanel({
  fixture,
  beat,
  delayLabel,
  fresh,
}: {
  fixture: Fixture;
  beat: RoomLiveState;
  delayLabel: string;
  fresh: boolean;
}) {
  const call = beat.calls.find((c) => c.call.status === "open" || c.call.status === "locked") ?? beat.calls.at(-1);
  const latest = beat.timeline[0];
  return (
    <div className="space-y-4 rounded-card border border-ash bg-parchment p-5">
      <div className="flex items-center justify-between">
        <Tag tone="muted">{delayLabel}</Tag>
        <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Fan view</span>
      </div>

      <Scoreline
        home={fixture.home}
        away={fixture.away}
        score={beat.fixtureState.score}
        status={beat.fixtureState.status}
        minute={beat.fixtureState.minute}
      />

      <div className={cn("rounded-lg border border-ash p-3", fresh && "animate-erupt")}>
        <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Latest</p>
        <p className="mt-1 font-mono text-body-sm text-off-black">{latest ? latest.label : "Warming up…"}</p>
      </div>

      {call ? (
        <div className="rounded-lg border border-ash p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-mono text-body-sm text-off-black">{call.call.prompt}</p>
            <StatePill
              state={
                call.call.status === "open"
                  ? "open"
                  : call.call.status === "locked"
                    ? "locked"
                    : call.outcome === "void"
                      ? "void"
                      : (call.outcome ?? "settled")
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ReplayView({ fixtureId }: { fixtureId: string }) {
  const replay = useReplay(fixtureId);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);

  const beats = replay.data?.beats ?? [];
  const maxIndex = Math.max(0, beats.length - 1);

  useEffect(() => {
    if (!playing || beats.length === 0) return;
    const timer = setInterval(() => {
      setPos((p) => {
        const next = p + STEP;
        if (next >= maxIndex) {
          setPlaying(false);
          return maxIndex;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, beats.length, maxIndex]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo />
          <Link href="/matches" className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black">
            Matches
          </Link>
        </Container>
      </header>

      <Container className="py-12">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="max-w-2xl space-y-3">
            <span className="inline-flex"><Tag dot="live">Judge replay</Tag></span>
            <h1 className="text-heading text-off-black">One goal. Two clocks. No spoilers.</h1>
            <p className="font-mono text-body-lg text-graphite">
              The same recorded match, replayed through the real room for two fans on different stream
              delays. Watch a goal reach each of them at the right moment — never early.
            </p>
          </div>

          {replay.status === "loading" ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Skeleton className="h-80 w-full rounded-card" />
              <Skeleton className="h-80 w-full rounded-card" />
            </div>
          ) : replay.status === "error" ? (
            <ErrorState hint={replay.error ?? undefined} onRetry={replay.reload} />
          ) : replay.status === "empty" || !replay.data ? (
            <EmptyState
              title="No replay for this match"
              hint="The corpus replay is available for recorded fixtures."
              action={<Button href="/replay/9001" variant="ghost" size="sm">Watch the demo replay</Button>}
            />
          ) : (
            <>
              <div className="grid gap-5 md:grid-cols-2">
                <ViewerPanel
                  fixture={replay.data.fixture}
                  beat={beats[clampIndex(pos - LAG_A, maxIndex)]!}
                  delayLabel="Amina · +8s stream"
                  fresh={playing}
                />
                <ViewerPanel
                  fixture={replay.data.fixture}
                  beat={beats[clampIndex(pos - LAG_B, maxIndex)]!}
                  delayLabel="Youssef · +42s stream"
                  fresh={false}
                />
              </div>

              <div className="flex flex-col gap-4 rounded-card border border-ash bg-parchment p-5 sm:flex-row sm:items-center">
                <Button variant="secondary" size="sm" onClick={() => setPlaying((p) => !p)}>
                  {playing ? "Pause" : pos >= maxIndex ? "Replay" : "Play"}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={maxIndex}
                  step={0.01}
                  value={pos}
                  onChange={(e) => {
                    if (Number(e.target.value) >= maxIndex) setPlaying(false);
                    setPos(Number(e.target.value));
                  }}
                  className="flex-1 accent-[var(--color-lake-blue)]"
                  aria-label="Replay position"
                />
                <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">
                  Feed time · leading edge
                </span>
              </div>

              <p className="font-mono text-body-sm text-graphite">
                Settlement always uses the feed&apos;s own clock — the delay only changes <em>when each fan
                sees it</em>. That&apos;s MatchSync: spoiler-safe for honest fans, and the same proof for
                everyone.
              </p>
            </>
          )}
        </div>
      </Container>
    </div>
  );
}
