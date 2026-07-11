import { ReceiptDetail } from "@/components/receipt-detail";

export default async function RoomReceiptPage({ params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const { id, receiptId } = await params;
  return <ReceiptDetail roomId={id} receiptId={receiptId} />;
}
