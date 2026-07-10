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
          <span className="text-parchment/60">World Cup 2026 ·</span> France–Morocco is live on your clock.
        </p>
        <Link
          href="/room/room-fra-mar"
          className="hidden shrink-0 rounded-pill border border-parchment/50 px-3 py-0.5 font-mono text-caption uppercase tracking-[0.08em] hover:bg-parchment hover:text-ink sm:inline-flex"
        >
          Watch
        </Link>
        <button
          onClick={() => setOpen(false)}
          aria-label="Dismiss"
          className="shrink-0 px-1 font-mono text-body-lg leading-none text-parchment/60 hover:text-parchment"
        >
          ×
        </button>
      </div>
    </div>
  );
}
