"use client";

import type { MatchStoryCard as Story } from "@fulltime/shared";
import { cn } from "@/lib/cn";

const TONE_LABEL: Record<Story["tone"], string> = {
  kickoff: "Kickoff",
  control: "Match pulse",
  pressure: "Pressure",
  goal: "Goal",
  break: "Phase",
  closing: "Full time",
  idle: "Pre-match",
};

export function MatchStoryCard({ story, className }: { story: Story; className?: string }) {
  return (
    <section
      className={cn(
        "border border-ash bg-white/40 p-4",
        story.tone === "goal" && "border-off-black bg-periwinkle-mist/35",
        story.tone === "pressure" && "border-coral/50 bg-coral/10",
        className,
      )}
      aria-live="polite"
    >
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-smoke">
        {TONE_LABEL[story.tone]} · feed-backed
      </p>
      <p className="text-body font-medium text-off-black">{story.headline}</p>
      <p className="mt-1.5 font-mono text-caption text-graphite">{story.detail}</p>
    </section>
  );
}
