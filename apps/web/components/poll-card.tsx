"use client";

import { useState } from "react";

import type { Poll } from "@fulltime/shared";

import { cn } from "@/lib/cn";

export function PollCard({
  poll,
  onVote,
  canVote,
  className,
}: {
  poll: Poll;
  onVote: (option: string) => void;
  canVote: boolean;
  className?: string;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const base = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const total = base + (choice ? 1 : 0);

  const pick = (id: string) => {
    if (!canVote || choice) return;
    setChoice(id);
    onVote(id);
  };

  return (
    <div className={cn("rounded-card border border-ash bg-parchment p-6", className)}>
      <p className="mb-1 font-mono text-caption uppercase tracking-[0.12em] text-smoke">Room poll · not scored</p>
      <h3 className="text-subheading text-off-black">{poll.question}</h3>
      <div className="mt-4 space-y-2">
        {poll.options.map((option) => {
          const votes = option.votes + (choice === option.id ? 1 : 0);
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
    </div>
  );
}
