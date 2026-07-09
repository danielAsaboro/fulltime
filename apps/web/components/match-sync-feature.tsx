import Link from "next/link";

import { Eyebrow } from "@/components/ui/primitives";

function Track({ name, minute, fill }: { name: string; minute: string; fill: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-caption uppercase tracking-[0.08em] text-off-black/70">
        <span>{name}</span>
        <span aria-hidden>⚽ {minute}</span>
      </div>
      <div className="relative h-2 rounded-pill bg-parchment/80">
        <div className="absolute inset-y-0 left-0 rounded-pill bg-off-black/80" style={{ width: `${fill}%` }} />
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-off-black ring-2 ring-parchment"
          style={{ left: `${fill}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/** The elevated Periwinkle feature — a colored surface with a gradient illustration (design.md). */
export function MatchSyncFeature() {
  return (
    <div className="grid items-center gap-8 rounded-card bg-periwinkle-mist p-8 sm:p-10 md:grid-cols-2">
      <div className="space-y-5">
        <Eyebrow>MatchSync · the wedge</Eyebrow>
        <h3 className="text-heading-sm text-off-black">One goal. Every fan on their own clock.</h3>
        <p className="font-mono text-body-lg text-graphite">
          A fan on an 8-second delay and a fan on 42 seconds sit in the same room without spoilers.
          Events, calls, reactions, and receipts each release at the right moment for that viewer —
          while settlement always uses the feed&apos;s own clock.
        </p>
        <Link
          href="/replay/9001"
          className="inline-flex items-center gap-2 font-mono text-body-sm uppercase tracking-[0.06em] text-off-black hover:text-lake-blue"
        >
          See it in the replay
          <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="relative overflow-hidden rounded-lg p-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 90% at 20% 20%, color-mix(in srgb, var(--color-coral) 60%, transparent), transparent 70%), radial-gradient(70% 90% at 90% 30%, color-mix(in srgb, var(--color-sky-blue) 60%, transparent), transparent 70%), radial-gradient(80% 90% at 60% 100%, color-mix(in srgb, var(--color-mint) 55%, transparent), transparent 70%)",
            filter: "blur(6px)",
          }}
          aria-hidden
        />
        <div className="relative space-y-6">
          <Track name="Amina · +8s stream" minute="23'" fill={30} />
          <Track name="Youssef · +42s stream" minute="23'" fill={70} />
          <p className="font-mono text-caption text-off-black/70">
            The goal hits the feed once. It reaches each fan at the right moment — never early.
          </p>
        </div>
      </div>
    </div>
  );
}
