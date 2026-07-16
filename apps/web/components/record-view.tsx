"use client";

import Link from "next/link";

import { useRecord, type RecordEntry } from "@/lib/data";
import { ReceiptChip } from "@/components/receipt-chip";
import { CopyLinkButton, ShareCard } from "@/components/share-card";
import { StatePill } from "@/components/ui/state-pill";
import { Container, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";

function EntryCard({ entry }: { entry: RecordEntry }) {
  const state = entry.outcome === "accepted" ? "accepted" : entry.outcome === "void" ? "void" : entry.outcome;
  return <article className="flex flex-col justify-between gap-4 rounded-card border border-ash bg-parchment p-5"><div className="space-y-2"><p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{entry.fixtureLabel}</p><p className="font-mono text-body text-off-black">{entry.prompt}</p><p className="font-mono text-caption text-smoke">Called {entry.chosenLabel}</p></div><div className="flex items-center justify-between gap-2 border-t border-ash pt-3"><div className="flex items-center gap-2"><StatePill state={state} />{entry.points > 0 ? <span className="font-mono text-body-sm font-medium tabular text-off-black">+{entry.points}</span> : null}</div><ReceiptChip state={entry.receiptState} roomId={String(entry.roomId)} receiptId={entry.receiptId} /></div><Link href={`/room/${encodeURIComponent(String(entry.roomId))}/replay`} className="font-mono text-caption text-lake-blue hover:underline">Open room replay →</Link></article>;
}

export function RecordView() {
  const record = useRecord();
  if (record.status === "loading") return <Container className="py-12"><Skeleton className="h-64 w-full rounded-card" /></Container>;
  if (record.status === "error") return <Container className="py-12"><ErrorState hint={record.error ?? undefined} onRetry={record.reload} /></Container>;
  if (record.status === "empty" || !record.data || record.data.entries.length === 0) return <Container className="py-12"><EmptyState title="No verified answers yet" hint="Accepted answers in rooms available to this Pear identity will collect here." /></Container>;
  const value = record.data;
  const correct = value.entries.filter((e) => e.outcome === "correct").length;
  const tagline =
    value.fanIq > 0
      ? `Backed my stand · ${value.fanIq.toLocaleString()} Fan IQ · ${Math.round(value.accuracy * 100)}% accuracy across ${value.matchesPlayed} matches.`
      : "Only accepted answers whose pinned receipts are available here.";
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-4xl space-y-10">
        <ShareCard
          eyebrow="Tournament record"
          title={value.displayName}
          stats={[
            { label: "Fan IQ", value: value.fanIq.toLocaleString() },
            { label: "Accuracy", value: `${Math.round(value.accuracy * 100)}%` },
            { label: "Hits", value: `${correct}/${value.totalCalls}` },
          ]}
          tagline={tagline}
        />
        <div className="flex flex-wrap items-center gap-3">
          <CopyLinkButton />
          <p className="font-mono text-caption text-smoke">
            {value.totalCalls} accepted answers · receipts remain room-scoped · no money on Fan IQ
          </p>
        </div>
        <section className="space-y-5">
          <h2 className="text-heading-sm text-off-black">Your answers</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {value.entries.map((entry) => (
              <EntryCard key={entry.receiptId} entry={entry} />
            ))}
          </div>
        </section>
      </div>
    </Container>
  );
}
