import type { MarketSaysCard as MarketSaysModel } from "@fulltime/shared";

import { cn } from "@/lib/cn";

export function MarketSaysCard({ card, className }: { card: MarketSaysModel; className?: string }) {
  return <div className={cn("rounded-card border border-ash bg-parchment p-5", className)}><p className="mb-2 font-mono text-caption uppercase tracking-[0.14em] text-smoke">Market says</p><p className="text-subheading text-off-black">{card.text}</p><p className="mt-3 font-mono text-caption text-smoke">Signed odds movement · context, not betting advice.</p></div>;
}
