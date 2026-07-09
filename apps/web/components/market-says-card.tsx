import type { MarketSaysCard as MarketSaysModel } from "@fulltime/shared";

import { cn } from "@/lib/cn";

/**
 * Market Says — odds movement in fan language. Rendered as an editorial pull-quote
 * (the serif announces) with a mono eyebrow. Deterministic templates only; the
 * footnote keeps it honest — context, never betting advice.
 */
export function MarketSaysCard({ card, className }: { card: MarketSaysModel; className?: string }) {
  return (
    <div className={cn("rounded-card border border-ash bg-parchment p-6", className)}>
      <p className="mb-2 font-mono text-caption uppercase tracking-[0.14em] text-smoke">Market says</p>
      <p className="text-subheading text-off-black">{card.text}</p>
      <p className="mt-3 font-mono text-caption text-smoke">Reads the odds. Not betting advice.</p>
    </div>
  );
}
