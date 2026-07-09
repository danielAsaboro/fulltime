import type { Metadata } from "next";

import { ReceiptDetail } from "@/components/receipt-detail";

export const metadata: Metadata = {
  title: "Receipt — FullTime",
  description: "The verifiable proof behind a settled call.",
};

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptDetail receiptId={id} />;
}
