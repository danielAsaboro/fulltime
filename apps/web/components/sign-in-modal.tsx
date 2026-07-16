"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { useData } from "@/lib/data";
import { generateDisplayName } from "@/lib/peer-identity";
import { PeerAvatar } from "@/components/peer-avatar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";

/**
 * Display name unlocks the local Pear identity used to sign room operations.
 * Default is an auto-generated name (e.g. Dancing Meadow) so first join is not a blank dull "A".
 */
export function SignInModal({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn?: () => void;
}) {
  const { signIn } = useData();
  const [name, setName] = useState(() => generateDisplayName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reshuffle = () => {
    setName(generateDisplayName());
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(name.trim());
      onSignedIn?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FullTime could not open your identity.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Join the room" title="Pick your peer look">
      <div className="space-y-5">
        <p className="font-mono text-body-sm text-graphite">
          We generated a name and mark for this device. Keep them, reshuffle, or type your own — your
          Pear identity still signs what you send.
        </p>

        <div className="flex items-center gap-4 rounded-[18px] border border-ash bg-white/50 p-4">
          <PeerAvatar userId={`preview:${name}`} displayName={name || "Peer"} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-smoke">You will appear as</p>
            <p className="truncate text-subheading text-off-black">{name.trim() || "…"}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={reshuffle} disabled={busy} aria-label="Generate another name">
            <RefreshCw className="size-3.5" />
            New
          </Button>
        </div>

        <TextField
          id="display-name"
          label="Display name"
          placeholder="Dancing Meadow"
          value={name}
          maxLength={48}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <Button variant="primary" fullWidth withArrow onClick={() => void submit()} disabled={!name.trim() || busy}>
          {busy ? "Signing in…" : "Enter the room"}
        </Button>
        {error ? (
          <p className="rounded-lg bg-coral/15 px-3 py-2 font-mono text-body-sm text-crimson" role="alert">
            {error}
          </p>
        ) : null}
        <p className="text-center font-mono text-caption text-smoke">
          You can read without signing in. Sign in to post, vote, react, or reply.
        </p>
      </div>
    </Sheet>
  );
}
