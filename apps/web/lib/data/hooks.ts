"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";

import { useData } from "./provider";
import type {
  Async,
  CalibrationView,
  FanReportView,
  FixtureCard,
  RecordView,
  ReceiptView,
  ReplayView,
  RoomLiveState,
  RoomPhase,
  RoomView,
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
  const { forcedState } = useData();
  const [state, setState] = useState<Internal<T>>({ status: "loading", data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (forcedState) return; // forced states are derived below, not stored
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
  }, [...deps, nonce, forcedState]);

  if (forcedState === "loading") return { status: "loading", data: null, error: null, reload };
  if (forcedState === "empty") return { status: "empty", data: null, error: null, reload };
  if (forcedState === "error")
    return { status: "error", data: null, error: "Forced error (mock controls)", reload };
  return { ...state, reload };
}

export function useFixtures(phase?: RoomPhase | "all"): Async<FixtureCard[]> {
  const { client } = useData();
  return useAsync<FixtureCard[]>(() => client.listFixtures(phase ? { phase } : {}), [phase]);
}

export function useRoom(roomId: string): Async<RoomView> {
  const { client } = useData();
  return useAsync(() => client.getRoom(roomId), [roomId]);
}

export function useRoomByInvite(code: string): Async<RoomView> {
  const { client } = useData();
  return useAsync(() => client.getRoomByInvite(code), [code]);
}

export function useReceipt(receiptId: string): Async<ReceiptView> {
  const { client } = useData();
  return useAsync(() => client.getReceipt(receiptId), [receiptId]);
}

export function useReport(roomId: string): Async<FanReportView> {
  const { client } = useData();
  return useAsync(() => client.getReport(roomId), [roomId]);
}

export function useRecord(): Async<RecordView> {
  const { client } = useData();
  return useAsync(() => client.getRecord(), []);
}

export function useReplay(fixtureId: string): Async<ReplayView> {
  const { client } = useData();
  return useAsync(() => client.getReplay(fixtureId), [fixtureId]);
}

export function useCalibration(roomId: string): Async<CalibrationView> {
  const { client } = useData();
  return useAsync(() => client.getCalibration(roomId), [roomId]);
}

/** Live room state via subscription; honours forced states from the mock controls. */
export function useRoomState(roomId: string): Async<RoomLiveState> {
  const { client, forcedState } = useData();
  const [state, setState] = useState<Internal<RoomLiveState>>({ status: "loading", data: null, error: null });

  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (forcedState) return; // forced states are derived below, not stored
    let alive = true;
    try {
      const unsubscribe = client.subscribeRoomState(roomId, (next) => {
        if (alive) setState({ status: "ready", data: next, error: null });
      });
      return () => {
        alive = false;
        unsubscribe();
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      queueMicrotask(() => {
        if (alive) setState({ status: "error", data: null, error: message });
      });
      return () => {
        alive = false;
      };
    }
  }, [roomId, forcedState, client, nonce]);

  const reload = () => setNonce((n) => n + 1);
  if (forcedState === "loading") return { status: "loading", data: null, error: null, reload };
  if (forcedState === "empty") return { status: "empty", data: null, error: null, reload };
  if (forcedState === "error")
    return { status: "error", data: null, error: "Forced error (mock controls)", reload };
  return { ...state, reload };
}
