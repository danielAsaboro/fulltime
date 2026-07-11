"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";

const FAQS = [
  {
    q: "Where are room messages stored?",
    a: "Each room is an encrypted Autobase replicated through Corestore. Members exchange the room data over Hyperswarm instead of posting it to a central chat database.",
  },
  {
    q: "Who can join?",
    a: "Only someone with an active signed invite can complete blind pairing and become a room writer. The creator can revoke or replace the invite and remove members.",
  },
  {
    q: "What can we do in a room?",
    a: "Members can send text messages, create and vote in polls, react to messages, reply in threads, and see who is online or typing.",
  },
  {
    q: "Do I need an account server?",
    a: "No. Choosing a display name creates or unlocks a local Pear identity on this device. That identity signs your room membership and operations.",
  },
  {
    q: "How large can a room be?",
    a: "A room admits up to 256 members. Invitees are non-indexer writers, so membership does not turn every device into an Autobase indexer.",
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
