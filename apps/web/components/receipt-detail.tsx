"use client";

import Link from "next/link";

import { useReceipt } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { ReceiptPanel } from "@/components/receipt-panel";

export function ReceiptDetail({ receiptId }: { receiptId: string }) {
  const receipt = useReceipt(receiptId);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo />
          <Link
            href="/record"
            className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black"
          >
            ← Record
          </Link>
        </Container>
      </header>

      <Container className="py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="space-y-2">
            <p className="font-mono text-caption uppercase tracking-[0.14em] text-smoke">Receipt</p>
            <h1 className="text-heading-sm text-off-black">The proof behind the call</h1>
          </div>

          {receipt.status === "loading" ? (
            <Skeleton className="h-64 w-full rounded-card" />
          ) : receipt.status === "error" ? (
            <ErrorState hint={receipt.error ?? undefined} onRetry={receipt.reload} />
          ) : receipt.status === "empty" || !receipt.data ? (
            <EmptyState
              title="Receipt not found"
              hint="This receipt isn't available. It may still be settling."
              action={<Button href="/record" variant="ghost" size="sm">Your record</Button>}
            />
          ) : (
            <>
              <ReceiptPanel view={receipt.data} />
              <p className="font-mono text-body-sm text-graphite">
                FullTime reads the match feed and checks each moment against the tournament&apos;s on-chain
                record. A checkmark only appears once that walk verifies — until then it stays honest as
                &ldquo;proof pending&rdquo;.
              </p>
            </>
          )}
        </div>
      </Container>
    </div>
  );
}
