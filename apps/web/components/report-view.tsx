"use client";

import Link from "next/link";

import { useReport, type ReportCall } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { StatePill } from "@/components/ui/state-pill";
import { CopyLinkButton, ShareCard } from "@/components/share-card";
import { ReceiptChip } from "@/components/receipt-chip";

function Highlight({ label, call }: { label: string; call?: ReportCall }) {
  if (!call) return null;
  return (
    <Card padding="lg" className="space-y-2">
      <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">{label}</p>
      <p className="text-subheading text-off-black">{call.prompt}</p>
      <div className="flex items-center gap-2">
        <StatePill state={call.outcome === "void" ? "void" : call.outcome} />
        {call.points > 0 ? (
          <span className="font-mono text-body-sm font-medium tabular text-off-black">+{call.points} IQ</span>
        ) : null}
        {call.difficultyPct != null ? (
          <span className="font-mono text-caption text-smoke">{call.difficultyPct}% chance</span>
        ) : null}
      </div>
    </Card>
  );
}

function CallRow({ call }: { call: ReportCall }) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="truncate font-mono text-body-sm text-off-black">{call.prompt}</p>
        <p className="font-mono text-caption text-smoke">Called {call.chosenLabel}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {call.points > 0 ? (
          <span className="font-mono text-body-sm font-medium tabular text-off-black">+{call.points}</span>
        ) : null}
        <ReceiptChip state={call.receiptState} receiptId={call.receiptId} />
      </div>
    </li>
  );
}

export function ReportView({ roomId }: { roomId: string }) {
  const report = useReport(roomId);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo />
          <Link
            href={`/room/${roomId}`}
            className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black"
          >
            ← Back to room
          </Link>
        </Container>
      </header>

      <Container className="py-12">
        {report.status === "loading" ? (
          <div className="space-y-6">
            <Skeleton className="h-72 w-full rounded-card" />
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        ) : report.status === "error" ? (
          <ErrorState hint={report.error ?? undefined} onRetry={report.reload} />
        ) : report.status === "empty" || !report.data ? (
          <EmptyState
            title="No report yet"
            hint="Your Fan Report unlocks at full time, once your calls have settled."
            action={<Button href={`/room/${roomId}`} variant="ghost" size="sm">Back to room</Button>}
          />
        ) : (
          <div className="mx-auto max-w-3xl space-y-10">
            <ShareCard
              eyebrow="Full-time · Fan Report"
              title={report.data.displayName}
              scoreline={`${report.data.fixture.home.shortName} ${report.data.finalScore.home}–${report.data.finalScore.away} ${report.data.fixture.away.shortName}`}
              stats={[
                { label: "Fan IQ", value: String(report.data.fanIq) },
                { label: "Accuracy", value: `${Math.round(report.data.accuracy * 100)}%` },
                { label: "Room rank", value: `#${report.data.rank}` },
              ]}
              tagline={report.data.accuracy >= 0.5 ? "Called it. Proof's in." : "Room got a few. On to the next."}
            />

            <div className="flex flex-wrap items-center gap-3">
              <CopyLinkButton />
              <Button href="/record" variant="ghost">
                Your tournament record
              </Button>
              <p className="font-mono text-caption text-smoke">
                Top {report.data.percentile}% of {report.data.roomSize.toLocaleString()} in the room
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Highlight label="Best read" call={report.data.bestRead} />
              <Highlight label="Hardest hit" call={report.data.highestDifficultyHit} />
              <Highlight label="Biggest miss" call={report.data.biggestMiss} />
            </div>

            <section>
              <h2 className="text-heading-sm text-off-black">Every call</h2>
              <ul className="mt-4 divide-y divide-ash border-t border-ash">
                {report.data.calls.map((call) => (
                  <CallRow key={call.callId} call={call} />
                ))}
              </ul>
            </section>
          </div>
        )}
      </Container>
    </div>
  );
}
