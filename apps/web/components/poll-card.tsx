"use client";

import { useState } from "react";

import type { Poll } from "@fulltime/shared";
import type { Fixture, RoomMarketReference } from "@fulltime/shared";

import { cn } from "@/lib/cn";
import { PollMarket } from "@/components/poll-market";

export function PollCard({
  poll,
  onVote,
  canVote,
  myVote,
  className,
  fixture,
  isAuthor = false,
  onAttachMarket,
}: {
  poll: Poll;
  onVote: (option: string) => void;
  canVote: boolean;
  myVote?: string;
  className?: string;
  fixture?: Fixture;
  isAuthor?: boolean;
  onAttachMarket?: (input: RoomMarketReference & { pollId: string }) => Promise<void>;
}) {
  const [optimisticChoice, setOptimisticChoice] = useState<string | null>(null);
  const choice = myVote ?? optimisticChoice;
  const base = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const hasPendingVote = Boolean(optimisticChoice && !myVote);
  const total = base + (hasPendingVote ? 1 : 0);

  const pick = (id: string) => {
    if (!canVote || choice) return;
    setOptimisticChoice(id);
    onVote(id);
  };

  return (
    <div className={cn("rounded-card border border-ash bg-parchment p-6", className)}>
      <p className="mb-1 font-mono text-caption uppercase tracking-[0.12em] text-smoke">Room poll</p>
      <h3 className="text-subheading text-off-black">{poll.question}</h3>
      <div className="mt-4 space-y-2">
        {poll.options.map((option) => {
          const votes = option.votes + (hasPendingVote && choice === option.id ? 1 : 0);
          const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
          const mine = choice === option.id;
          return (
            <button
              key={option.id}
              onClick={() => pick(option.id)}
              disabled={!canVote || Boolean(choice)}
              className={cn(
                "relative w-full overflow-hidden rounded-lg border px-4 py-3 text-left",
                mine ? "border-off-black" : "border-ash",
                canVote && !choice && "hover:border-off-black",
              )}
            >
              <span className="absolute inset-y-0 left-0 bg-periwinkle-mist/50" style={{ width: `${pct}%` }} aria-hidden />
              <span className="relative flex items-center justify-between font-mono text-body text-off-black">
                <span>{option.label}</span>
                <span className="tabular text-graphite">{pct}%</span>
              </span>
            </button>
          );
        })}
      </div>
      {fixture && onAttachMarket ? <PollMarket poll={poll} fixture={fixture} isAuthor={isAuthor} onAttach={onAttachMarket} /> : null}
    </div>
  );
}
