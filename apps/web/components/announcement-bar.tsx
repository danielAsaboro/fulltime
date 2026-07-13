"use client";

import Link from "next/link";
import { useState } from "react";

/** Top-of-page notification strip — black band, white mono, white pill, dismissible (design.md). */
export function AnnouncementBar() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div className="bg-ink text-parchment">
      <div className="mx-auto flex h-[62px] max-w-[var(--page-max-width)] items-center gap-3 px-5 sm:px-8">
        <p className="flex-1 truncate text-center font-mono text-body-sm tracking-[-0.02em]">
          <span className="text-parchment/60">World Cup 2026 ·</span> Pick a fixture and bring your people.
        </p>
        <Link
          href="#how-it-works"
          className="hidden min-h-10 shrink-0 items-center rounded-pill border border-parchment/50 px-3 font-mono text-caption uppercase tracking-[0.08em] hover:bg-parchment hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-parchment sm:inline-flex"
        >
          How it works
        </Link>
        <button
          onClick={() => setOpen(false)}
          aria-label="Dismiss"
          className="grid size-10 shrink-0 place-items-center rounded-full font-mono text-body-lg leading-none text-parchment/60 hover:text-parchment focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-parchment"
        >
          ×
        </button>
      </div>
    </div>
  );
}
