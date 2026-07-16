"use client";

import { useMemo } from "react";
import type { Fixture } from "@fulltime/shared";
import { banterForFixture } from "@/lib/data/seed/match-banter";
import { cn } from "@/lib/cn";

export function SeedBanterStrip({
  fixture,
  roomName,
  canPost,
  onPick,
  className,
}: {
  fixture?: Fixture;
  roomName?: string;
  canPost: boolean;
  onPick: (text: string) => void;
  className?: string;
}) {
  const lines = useMemo(
    () =>
      banterForFixture({
        fixtureId: fixture ? String(fixture.id) : undefined,
        homeName: fixture?.home.name,
        awayName: fixture?.away.name,
        homeCode: fixture?.home.shortName ?? null,
        awayCode: fixture?.away.shortName ?? null,
        roomName,
      }),
    [fixture, roomName],
  );

  if (!lines.length) return null;

  return (
    <div className={cn("border-b border-ash bg-parchment/90 px-3 py-2 sm:px-4", className)}>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-smoke">
        Match energy · tap to post
      </p>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {lines.map((line) => (
          <button
            key={line.id}
            type="button"
            disabled={!canPost}
            onClick={() => onPick(line.text)}
            className={cn(
              "max-w-[220px] shrink-0 rounded-full border border-ash bg-white/70 px-3 py-1.5 text-left font-mono text-[11px] leading-snug text-off-black hover:border-off-black",
              !canPost && "opacity-50",
            )}
            title={line.text}
          >
            <span className="line-clamp-2">{line.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
