"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { connectPlayWallet, type ConnectedSlipWallet } from "@/lib/slip/wallet";

interface PrivyConfiguration {
  appId: string | null;
  clientId: string | null;
  network: "localnet" | "devnet" | "mainnet-beta";
  rpcUrl: string | null;
  websocketUrl: string | null;
}

interface SlipWalletContextValue {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  wallet: ConnectedSlipWallet | null;
  connect(network: PrivyConfiguration["network"]): Promise<ConnectedSlipWallet | null>;
  logout(): Promise<void>;
}

const SlipWalletContext = createContext<SlipWalletContextValue | null>(null);

export function FullTimeWalletProvider({ children, configuration }: { children: ReactNode; configuration: PrivyConfiguration }) {
  return <PlayWalletRuntime network={configuration.network}>{children}</PlayWalletRuntime>;
}

function PlayWalletRuntime({ children, network }: { children: ReactNode; network: PrivyConfiguration["network"] }) {
  const [wallet, setWallet] = useState<ConnectedSlipWallet | null>(null);
  const value = useMemo<SlipWalletContextValue>(() => ({
    configured: true,
    ready: true,
    authenticated: Boolean(wallet),
    wallet,
    connect: async () => {
      const connected = await connectPlayWallet(network);
      setWallet(connected);
      return connected;
    },
    logout: async () => setWallet(null),
  }), [network, wallet]);
  return <SlipWalletContext.Provider value={value}>{children}</SlipWalletContext.Provider>;
}

/*
 * Privy remains installed and its previous provider path is intentionally
 * paused for this local play dogfood. Re-enable it here after the signing UX is
 * proven; do not delete the dependency or configuration in the meantime.
 */

export function useSlipWallet() {
  const value = useContext(SlipWalletContext);
  if (!value) throw new Error("FullTime wallet provider is missing");
  return value;
}
