"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { getDataClient } from "./client";
import { getPeerBridge, type PeerBridgeConfig } from "./live/peer-bridge";
import type { FullTimeData, Session } from "./types";

type NetworkConfigurationState =
  | { status: "loading" }
  | { status: "ready"; config: PeerBridgeConfig }
  | { status: "stale"; config: PeerBridgeConfig }
  | { status: "unavailable"; message: string };

interface DataContextValue {
  client: FullTimeData;
  session: Session | null;
  networkConfiguration: NetworkConfigurationState;
  signIn: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getDataClient);
  const [session, setSession] = useState<Session | null>(null);
  const [networkConfiguration, setNetworkConfiguration] = useState<NetworkConfigurationState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    void getPeerBridge().getConfig().then((config) => {
      if (!alive) return;
      setNetworkConfiguration(config.networkConfig === "stale" ? { status: "stale", config } : { status: "ready", config });
      void client.getSession().then((s) => {
        if (alive) setSession(s);
      }).catch(() => {
        if (alive) setSession(null);
      });
    }).catch((reason: unknown) => {
      if (!alive) return;
      setSession(null);
      setNetworkConfiguration({
        status: "unavailable",
        message: reason instanceof Error ? reason.message : "The local FullTime peer bridge is unavailable.",
      });
    });
    return () => {
      alive = false;
    };
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

  const value: DataContextValue = {
    client,
    session,
    networkConfiguration,
    signIn,
    signOut,
  };

  return (
    <DataContext.Provider value={value}>
      {networkConfiguration.status === "unavailable" ? (
        <ConfigurationUnavailable message={networkConfiguration.message} />
      ) : (
        <>
          {networkConfiguration.status === "stale" ? <StaleConfigurationNotice /> : null}
          {children}
        </>
      )}
    </DataContext.Provider>
  );
}

function StaleConfigurationNotice() {
  return (
    <div className="border-b border-gold/60 bg-gold/20 px-5 py-2 text-center font-mono text-caption text-off-black" role="status">
      Using the last verified FullTime network configuration while this device is offline. Rooms remain local and will refresh when FullTime reconnects.
    </div>
  );
}

function ConfigurationUnavailable({ message }: { message: string }) {
  const identityLocked = message.toLowerCase().includes("protected identity") || message.toLowerCase().includes("decrypt");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetIdentity = async () => {
    const reset = window.fullTimePeers?.resetIdentity;
    if (!reset) {
      setResetError("Open this recovery screen in the FullTime desktop window to reset the device identity.");
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      await reset();
    } catch (reason) {
      setResetting(false);
      setResetError(reason instanceof Error ? reason.message : "FullTime could not reset this device identity.");
    }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-parchment px-5 py-12">
      <section className="max-w-xl border border-ash bg-white/60 p-7 text-center sm:p-10">
        <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">{identityLocked ? "Identity locked" : "Configuration unavailable"}</p>
        <h1 className="mt-3 text-heading-sm text-off-black">{identityLocked ? "FullTime cannot unlock this device." : "FullTime cannot open peer rooms yet."}</h1>
        <p className="mt-4 font-mono text-body-sm text-graphite">{message}</p>
        <p className="mt-4 font-mono text-body-sm text-graphite">
          {identityLocked ? "The existing encrypted identity has been preserved. Open FullTime from the macOS account that created it; resetting it would create a different peer identity and is never done automatically." : "Connect this device so FullTime can verify its network configuration, then restart the desktop app."}
        </p>
        {identityLocked ? (
          <div className="mt-6">
            <button
              type="button"
              className="border border-off-black bg-off-black px-5 py-3 font-mono text-caption uppercase tracking-[0.08em] text-white disabled:cursor-wait disabled:opacity-60"
              disabled={resetting}
              onClick={() => void resetIdentity()}
            >
              {resetting ? "Archiving and restarting…" : "Reset this device"}
            </button>
            <p className="mt-3 font-mono text-caption text-smoke">The copied identity will be archived, not deleted. FullTime will restart with a new identity for this Mac.</p>
            {resetError ? <p className="mt-3 font-mono text-caption text-red" role="alert">{resetError}</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used within <DataProvider>");
  return value;
}
