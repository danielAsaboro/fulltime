"use client";

import Link from "next/link";

import { useRoomReceipt } from "@/lib/data";
import { ReceiptPanel } from "@/components/receipt-panel";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";

export function ReceiptDetail({ roomId, receiptId }: { roomId: string; receiptId: string }) {
  const receipt = useRoomReceipt(roomId, receiptId);
  return <div className="min-h-dvh"><header className="border-b border-ash"><Container className="flex h-[72px] items-center justify-between"><Logo href="/app" /><Link href={`/room/${encodeURIComponent(roomId)}`} className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black">← Room</Link></Container></header><Container className="py-12"><div className="mx-auto max-w-2xl space-y-6"><div className="space-y-2"><p className="font-mono text-caption uppercase tracking-[0.14em] text-smoke">Room receipt</p><h1 className="text-heading-sm text-off-black">The proof behind the answer</h1></div>{receipt.status === "loading" ? <Skeleton className="h-64 w-full rounded-card" /> : receipt.status === "error" ? <ErrorState hint={receipt.error ?? undefined} onRetry={receipt.reload} /> : receipt.status === "empty" || !receipt.data ? <EmptyState title="Receipt not found" hint="This private room does not reference that receipt." action={<Button href={`/room/${encodeURIComponent(roomId)}`} variant="ghost" size="sm">Back to room</Button>} /> : <><ReceiptPanel receipt={receipt.data} /><p className="font-mono text-body-sm text-graphite">Acceptance is real and independently signed. Anchoring remains proof pending until a configured observer completes its external verification.</p></>}</div></Container></div>;
}
