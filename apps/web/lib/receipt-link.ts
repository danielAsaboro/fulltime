/** Room context is mandatory because receipt references live in encrypted room history. */
export function roomReceiptHref(roomId: string, receiptId: string): string {
  return `/room/${encodeURIComponent(roomId)}/receipt/${encodeURIComponent(receiptId)}`;
}
