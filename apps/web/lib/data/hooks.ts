"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList } from "react";

import { useData } from "./provider";
import type {
  Async,
  FixtureCard,
  LocalRecordView,
  RoomFeedItem,
  RoomLiveState,
  RoomPhase,
  RoomReceiptView,
  RoomReplay,
  RoomView,
  ThreadReply,
} from "./types";

export type { Async } from "./types";

interface Internal<T> {
  status: Async<T>["status"];
  data: T | null;
  error: string | null;
}

function useAsync<T>(
  loader: () => Promise<T | null>,
  deps: DependencyList,
  isEmpty?: (value: T) => boolean,
): Async<T> {
  const [state, setState] = useState<Internal<T>>({ status: "loading", data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    loader()
      .then((value) => {
        if (!alive) return;
        let empty = value == null;
        if (!empty && Array.isArray(value) && value.length === 0) empty = true;
        if (!empty && isEmpty && isEmpty(value as T)) empty = true;
        setState({ status: empty ? "empty" : "ready", data: value, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({ status: "error", data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload };
}

export function useFixtures(phase?: RoomPhase | "all"): Async<FixtureCard[]> {
  const { client } = useData();
  const [state, setState] = useState<Internal<FixtureCard[]>>({ status: "loading", data: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    const load = () => {
      void client.listFixtures(phase ? { phase } : {}).then((fixtures) => {
        if (!alive) return;
        setState({
          status: fixtures.length === 0 ? "empty" : "ready",
          data: fixtures.length === 0 ? null : fixtures,
          error: null,
        });
      }).catch((error: unknown) => {
        if (alive) setState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
      });
    };
    try {
      unsubscribe = client.subscribeFixtures(load);
      load();
    } catch (error) {
      queueMicrotask(() => {
        if (alive) {
          setState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
        }
      });
    }
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [client, phase, nonce]);

  return { ...state, reload: () => setNonce((value) => value + 1) };
}

export function useRoom(roomId: string): Async<RoomView> {
  const { client, session } = useData();
  return useAsync(() => client.getRoom(roomId), [roomId, session?.userId]);
}

export function useRooms(): Async<RoomView[]> {
  const { client, session } = useData();
  return useAsync(() => client.listRooms(), [client, session?.userId]);
}

export function useRoomByInvite(code: string): Async<RoomView> {
  const { client } = useData();
  return useAsync(() => client.getRoomByInvite(code), [code]);
}

/** Live room state from the Pear room subscription. */
export function useRoomState(roomId: string): Async<RoomLiveState> {
  const { client, session } = useData();
  const [state, setState] = useState<Internal<RoomLiveState>>({ status: "loading", data: null, error: null });

  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    try {
      unsubscribe = client.subscribeRoomState(roomId, (next) => {
        if (alive) setState({ status: "ready", data: next, error: null });
      });
      void client.getRoomState(roomId).then((next) => {
        if (alive) setState({ status: "ready", data: next, error: null });
      }).catch((err: unknown) => {
        if (alive) setState({ status: "error", data: null, error: err instanceof Error ? err.message : String(err) });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queueMicrotask(() => {
        if (alive) setState({ status: "error", data: null, error: message });
      });
    }
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [roomId, client, nonce, session?.userId]);

  const reload = () => setNonce((n) => n + 1);
  return { ...state, reload };
}

export function useRoomReceipt(roomId: string, receiptId: string): Async<RoomReceiptView> {
  const { client } = useData();
  return useAsync(() => client.getRoomReceipt(roomId, receiptId), [client, roomId, receiptId]);
}

export function useRecord(): Async<LocalRecordView> {
  const { client, session } = useData();
  return useAsync(() => client.getRecord(), [client, session?.userId]);
}

export function useRoomReplay(roomId: string): Async<RoomReplay> {
  const { client, session } = useData();
  return useAsync(() => client.getRoomReplay(roomId), [client, roomId, session?.userId]);
}

export interface RoomHistoryPages {
  items: RoomFeedItem[];
  hasMore: boolean;
  loadingOlder: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
}

export function useRoomHistory(roomId: string, liveItems: readonly RoomFeedItem[]): RoomHistoryPages {
  const { client, session } = useData();
  const liveRef = useRef(liveItems);
  useEffect(() => { liveRef.current = liveItems; }, [liveItems]);
  const [older, setOlder] = useState<RoomFeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void client.getRoomHistoryPage(roomId, { limit: 100 }).then((page) => {
      if (!alive) return;
      setOlder([]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    }).catch((reason: unknown) => {
      if (!alive) return;
      setOlder([]);
      setCursor(null);
      setHasMore(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { alive = false; };
  }, [client, roomId, session?.userId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !cursor) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const known = new Set([...older, ...liveRef.current].map((item) => String(item.id)));
      let nextCursor: string | null = cursor;
      let nextHasMore: boolean = hasMore;
      let discovered: RoomFeedItem[] = [];
      for (let scan = 0; scan < 8 && nextCursor && nextHasMore && discovered.length === 0; scan++) {
        const page = await client.getRoomHistoryPage(roomId, { limit: 100, cursor: nextCursor });
        nextCursor = page.nextCursor;
        nextHasMore = page.hasMore;
        discovered = page.items.filter((item) => !known.has(String(item.id)));
      }
      if (discovered.length) {
        setOlder((current) => mergeById([...discovered].reverse(), current));
      }
      setCursor(nextCursor);
      setHasMore(nextHasMore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Older messages could not be loaded.");
    } finally {
      setLoadingOlder(false);
    }
  }, [client, cursor, hasMore, loadingOlder, older, roomId]);

  const items = useMemo(() => mergeById(older, liveItems), [liveItems, older]);
  return { items, hasMore, loadingOlder, error, loadOlder };
}

export interface RoomThreadPages {
  replies: ThreadReply[];
  hasMore: boolean;
  loadingOlder: boolean;
  error: string | null;
  loadOlder: () => Promise<void>;
  addReply: (reply: ThreadReply) => void;
}

export function useRoomThread(
  roomId: string,
  itemId: string,
  liveReplies: readonly ThreadReply[],
): RoomThreadPages {
  const { client, session } = useData();
  const liveRef = useRef(liveReplies);
  useEffect(() => { liveRef.current = liveReplies; }, [liveReplies]);
  const [loaded, setLoaded] = useState<ThreadReply[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void client.getRoomThreadPage(roomId, itemId, { limit: 100 }).then((page) => {
      if (!alive) return;
      setLoaded([...page.items].reverse());
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    }).catch((reason: unknown) => {
      if (!alive) return;
      setLoaded([]);
      setCursor(null);
      setHasMore(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { alive = false; };
  }, [client, itemId, roomId, session?.userId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !cursor) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const known = new Set([...loaded, ...liveRef.current].map((reply) => String(reply.id)));
      let nextCursor: string | null = cursor;
      let nextHasMore: boolean = hasMore;
      let discovered: ThreadReply[] = [];
      for (let scan = 0; scan < 8 && nextCursor && nextHasMore && discovered.length === 0; scan++) {
        const page = await client.getRoomThreadPage(roomId, itemId, { limit: 100, cursor: nextCursor });
        nextCursor = page.nextCursor;
        nextHasMore = page.hasMore;
        discovered = page.items.filter((reply) => !known.has(String(reply.id)));
      }
      if (discovered.length) setLoaded((current) => mergeById([...discovered].reverse(), current));
      setCursor(nextCursor);
      setHasMore(nextHasMore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Older replies could not be loaded.");
    } finally {
      setLoadingOlder(false);
    }
  }, [client, cursor, hasMore, itemId, loaded, loadingOlder, roomId]);

  const addReply = useCallback((reply: ThreadReply) => {
    setLoaded((current) => mergeById(current, [reply]));
  }, []);
  const replies = useMemo(() => mergeById(loaded, liveReplies), [liveReplies, loaded]);
  return { replies, hasMore, loadingOlder, error, loadOlder, addReply };
}

function mergeById<T extends { id: unknown }>(older: readonly T[], newer: readonly T[]): T[] {
  const latest = new Map<string, T>();
  const order: string[] = [];
  for (const value of [...older, ...newer]) {
    const id = String(value.id);
    if (!latest.has(id)) order.push(id);
    latest.set(id, value);
  }
  return order.map((id) => latest.get(id)!);
}
