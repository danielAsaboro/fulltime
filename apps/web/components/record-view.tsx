"use client";

import { useRecord, type RecordEntry } from "@/lib/data";
import { Container, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { Flag } from "@/components/ui/flag";
import { StatePill } from "@/components/ui/state-pill";
import { CopyLinkButton, ShareCard } from "@/components/share-card";
import { ReceiptChip } from "@/components/receipt-chip";

function EntryCard({ entry }: { entry: RecordEntry }) {
  return (
    <div className="flex flex-col justify-between gap-4 rounded-card border border-ash bg-parchment p-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-caption uppercase tracking-[0.1em] text-smoke">
            {entry.homeCode ? <Flag code={entry.homeCode} size={14} /> : null}
            {entry.awayCode ? <Flag code={entry.awayCode} size={14} /> : null}
            {entry.fixtureLabel}
          </span>
          {entry.minute != null ? (
            <span className="font-mono text-caption tabular text-smoke">{entry.minute}&apos;</span>
          ) : null}
        </div>
        <p className="font-mono text-body text-off-black">{entry.prompt}</p>
        <p className="font-mono text-caption text-smoke">Called {entry.chosenLabel}</p>
      </div>
      <div className="flex items-center justify-between border-t border-ash pt-3">
        <div className="flex items-center gap-2">
          <StatePill state={entry.outcome === "void" ? "void" : entry.outcome} />
          {entry.points > 0 ? (
            <span className="font-mono text-body-sm font-medium tabular text-off-black">+{entry.points}</span>
          ) : null}
        </div>
        <ReceiptChip state={entry.receiptState} receiptId={entry.receiptId} />
      </div>
    </div>
  );
}

export function RecordView() {
  const record = useRecord();

  if (record.status === "loading") {
    return (
      <Container className="py-12">
        <Skeleton className="h-64 w-full rounded-card" />
      </Container>
    );
  }
  if (record.status === "error") {
    return (
      <Container className="py-12">
        <ErrorState hint={record.error ?? undefined} onRetry={record.reload} />
      </Container>
    );
  }
  if (record.status === "empty" || !record.data) {
    return (
      <Container className="py-12">
        <EmptyState title="No record yet" hint="Make some calls in a room and they'll collect here with their receipts." />
      </Container>
    );
  }

  const r = record.data;
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-4xl space-y-10">
        <ShareCard
          eyebrow="Tournament record"
          title={r.displayName}
          stats={[
            { label: "Fan IQ", value: r.fanIq.toLocaleString() },
            { label: "Accuracy", value: `${Math.round(r.accuracy * 100)}%` },
            { label: "Matches", value: String(r.matchesPlayed) },
          ]}
          tagline="Every call, with the proof still attached."
        />

        <div className="flex flex-wrap items-center gap-3">
          <CopyLinkButton />
          <p className="font-mono text-caption text-smoke">{r.totalCalls} calls logged · receipts verifiable</p>
        </div>

        <section className="space-y-5">
          <h2 className="text-heading-sm text-off-black">The album</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {r.entries.map((entry) => (
              <EntryCard key={entry.callId} entry={entry} />
            ))}
          </div>
        </section>
      </div>
    </Container>
  );
}
