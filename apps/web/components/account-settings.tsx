"use client";

import { Settings, X } from "lucide-react";
import { useState } from "react";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function AccountSettingsButton() {
  const { session, signIn, signOut } = useData();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetAvailable = typeof window !== "undefined" && typeof window.fullTimePeers?.resetIdentity === "function";

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Account settings could not be updated."); }
    finally { setBusy(false); }
  };

  return <>
    <button type="button" onClick={() => { setName(session?.displayName ?? ""); setOpen(true); }} className="grid size-9 place-items-center rounded-full border border-ash hover:border-off-black" aria-label="Account settings"><Settings className="size-4" /></button>
    {open ? <div className="fixed inset-0 z-[100] flex justify-end bg-off-black/35" role="dialog" aria-modal="true" aria-label="Account settings">
      <section className="h-full w-full max-w-md overflow-y-auto bg-parchment p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between"><div><p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Account</p><h2 className="mt-1 text-heading-sm">Settings</h2></div><button type="button" onClick={() => setOpen(false)} className="grid size-9 place-items-center" aria-label="Close settings"><X className="size-5" /></button></div>
        {session ? <div className="mt-8 space-y-7">
          <section><label className="font-mono text-caption uppercase tracking-[0.1em] text-smoke" htmlFor="account-display-name">Display name</label><input id="account-display-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} className="mt-2 w-full rounded-lg border border-ash bg-white px-4 py-3 outline-none focus:border-off-black" /><Button className="mt-3" size="sm" disabled={busy || !name.trim() || name.trim() === session.displayName} onClick={() => void run(async () => { await signIn(name.trim()); })}>Save name</Button></section>
          <section className="border-t border-ash pt-5"><p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Account ID</p><p className="mt-2 break-all font-mono text-caption text-graphite">{session.userId}</p></section>
          <section className="border-t border-ash pt-5"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await signOut(); setOpen(false); })}>Sign out</Button></section>
          {resetAvailable ? <section className="border-t border-crimson/30 pt-5"><p className="font-mono text-caption uppercase tracking-[0.1em] text-crimson">Danger zone</p><p className="mt-2 text-body-sm text-graphite">Archives this device’s peer store and restarts FullTime with a new identity.</p><Button variant="ghost" size="sm" className="mt-3 border-crimson text-crimson" disabled={busy} onClick={() => { if (window.confirm("Reset this device account? The current peer store will be archived and FullTime will restart with a new identity.")) void run(() => window.fullTimePeers!.resetIdentity!()); }}>Reset account</Button></section> : null}
          {error ? <p className="font-mono text-caption text-crimson" role="alert">{error}</p> : null}
        </div> : <p className="mt-8 text-body-sm text-graphite">Sign in to manage this device identity.</p>}
      </section>
    </div> : null}
  </>;
}
