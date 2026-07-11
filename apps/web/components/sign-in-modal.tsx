"use client";

import { useState } from "react";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";

/**
 * A display name unlocks the local Pear identity used to sign room operations.
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(name);
      onSignedIn?.();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "FullTime could not open your identity.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Join the room" title="Sign in">
      <div className="space-y-5">
        <p className="font-mono text-body-sm text-graphite">
          Pick a display name for this device. Your local Pear identity signs the room operations you send.
        </p>
        <TextField
          id="display-name"
          label="Display name"
          placeholder="e.g. Amina"
          value={name}
          maxLength={24}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <Button variant="primary" fullWidth withArrow onClick={submit} disabled={!name.trim() || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {error ? <p className="rounded-lg bg-coral/15 px-3 py-2 font-mono text-body-sm text-crimson" role="alert">{error}</p> : null}
        <p className="text-center font-mono text-caption text-smoke">
          You can read an available room without signing in. Sign in to post, vote, react, or reply.
        </p>
      </div>
    </Sheet>
  );
}
