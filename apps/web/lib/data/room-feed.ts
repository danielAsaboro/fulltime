import type { RoomFeedItem, ThreadReply } from "./types";

/** Canonical chronological order for the mixed room feed. */
export function compareRoomFeedItems(a: RoomFeedItem, b: RoomFeedItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return String(a.id).localeCompare(String(b.id));
}

/** Dedupe by stable item ID, then order by creation time. */
export function orderRoomFeedItems(items: readonly RoomFeedItem[]): RoomFeedItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(compareRoomFeedItems);
}

/** Thread replies always use wall-clock creation time, then stable reply ID. */
export function orderThreadReplies(replies: readonly ThreadReply[]): ThreadReply[] {
  return [...replies].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return String(a.id).localeCompare(String(b.id));
  });
}
