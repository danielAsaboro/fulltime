"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

const FAQS = [
  {
    q: "Is this betting?",
    a: "No. Calls are points-only — you play for Fan IQ and bragging rights, never money. No stakes, no sportsbook flow. That keeps it mainstream and honest.",
  },
  {
    q: "How does it not spoil me?",
    a: "You tell FullTime your stream delay once. Every event, call, reaction, and receipt releases at feed-time plus your delay — so nothing ever lands before your own screen shows it.",
  },
  {
    q: "What's a receipt?",
    a: "Proof that a call settled from verified match data. It reads in plain language first; a checkmark only appears once the data is anchored. Until then it honestly says “proof pending”.",
  },
  {
    q: "Do I need crypto to play?",
    a: "No. You sign in with a name. Verification happens quietly in the background — there's no wallet, no jargon, and no crypto furniture anywhere in the room.",
  },
  {
    q: "Can my group have a private room?",
    a: "Yes. Share an invite link for a private room with its own leaderboard, riding the same live match feed. Global tallies still show as ambient crowd so five friends feel like a full stadium.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="border-t border-ash">
      {FAQS.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q} className="border-b border-ash">
            <button
              onClick={() => setOpen(isOpen ? null : index)}
              className="flex w-full items-center justify-between gap-6 py-10 text-left"
              aria-expanded={isOpen}
            >
              <span className="text-subheading text-off-black">{item.q}</span>
              <span
                className={cn("shrink-0 text-body-lg text-off-black transition-transform", isOpen && "rotate-180")}
                aria-hidden
              >
                ↓
              </span>
            </button>
            {isOpen ? <p className="max-w-2xl pb-10 font-mono text-body text-graphite">{item.a}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
