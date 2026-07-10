"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { DATA_MODE, getDataClient } from "./client";
import { MockDataClient } from "./mock/index";
import { SCENARIO_LABELS, type ScenarioLabel } from "./mock/scenario";
import type { FullTimeData, RoomView, Session } from "./types";

export type ForcedState = "loading" | "empty" | "error" | null;

interface DataContextValue {
  client: FullTimeData;
  mode: "mock" | "live";
  session: Session | null;
  signIn: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterDemoRoom: () => Promise<RoomView>;
  forcedState: ForcedState;
  setForcedState: (s: ForcedState) => void;
  scenario: ScenarioLabel | null;
  setScenario: (s: ScenarioLabel) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getDataClient);
  const [session, setSession] = useState<Session | null>(null);
  const [forcedState, setForcedState] = useState<ForcedState>(null);
  const [scenario, setScenarioState] = useState<ScenarioLabel | null>(null);

  useEffect(() => {
    let alive = true;
    client.getSession().then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, [client]);

  useEffect(() => {
    if (!(client instanceof MockDataClient)) return;
    const syncScenario = () => setScenarioState(client.scenarioLabel);
    syncScenario();
    const timer = window.setInterval(syncScenario, 500);
    return () => window.clearInterval(timer);
  }, [client]);

  const signIn = useCallback(
    async (displayName: string) => {
      const s = await client.signIn(displayName);
      setSession(s);
    },
    [client],
  );

  const signOut = useCallback(async () => {
    await client.signOut();
    setSession(null);
  }, [client]);

  const enterDemoRoom = useCallback(async () => {
    setForcedState(null);
    const entry = await client.enterDemoRoom();
    setSession(entry.session);
    setScenarioState("prematch");
    return entry.room;
  }, [client]);

  const setScenario = useCallback(
    (label: ScenarioLabel) => {
      setScenarioState(label);
      if (client instanceof MockDataClient) client.jumpTo(label);
    },
    [client],
  );

  const value: DataContextValue = {
    client,
    mode: DATA_MODE,
    session,
    signIn,
    signOut,
    enterDemoRoom,
    forcedState,
    setForcedState,
    scenario,
    setScenario,
  };

  return (
    <DataContext.Provider value={value}>
      {children}
      {DATA_MODE === "mock" ? <MockControls /> : null}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used within <DataProvider>");
  return value;
}

/** Mock-only affordance: jump the scripted room and force loading/empty/error. */
function MockControls() {
  const { forcedState, setForcedState, scenario, setScenario } = useData();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 rounded-pill border border-ash bg-parchment px-3 py-2 font-mono text-caption uppercase tracking-[0.1em] text-smoke shadow-[var(--shadow-md)] hover:text-off-black lg:bottom-4"
      >
        ● Mock
      </button>
    );
  }

  const forced: ForcedState[] = [null, "loading", "empty", "error"];

  return (
    <div className="fixed bottom-24 right-4 z-40 w-64 space-y-3 rounded-lg border border-ash bg-parchment p-4 shadow-[var(--shadow-md)] lg:bottom-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Mock controls</span>
        <button onClick={() => setOpen(false)} className="font-mono text-body-sm text-smoke hover:text-off-black">
          ×
        </button>
      </div>

      <div className="space-y-1.5">
        <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Scenario</span>
        <div className="flex flex-wrap gap-1">
          {SCENARIO_LABELS.map((label) => (
            <button
              key={label}
              onClick={() => setScenario(label)}
              className={cn(
                "rounded-pill border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]",
                scenario === label ? "border-off-black bg-off-black text-parchment" : "border-ash text-graphite",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Force state</span>
        <div className="flex gap-1">
          {forced.map((f) => (
            <button
              key={f ?? "live"}
              onClick={() => setForcedState(f)}
              className={cn(
                "rounded-pill border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]",
                forcedState === f ? "border-off-black bg-off-black text-parchment" : "border-ash text-graphite",
              )}
            >
              {f ?? "live"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
