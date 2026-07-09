"use client";

import { useState } from "react";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";

/**
 * "Sign in" — SIWS under the hood, but zero crypto vocabulary anywhere in copy.
 * Pick a name; that's the whole flow the fan sees.
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

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await signIn(name);
      onSignedIn?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Join the room" title="Sign in">
      <div className="space-y-5">
        <p className="font-mono text-body-sm text-graphite">
          Pick a name for the room. We&apos;ll remember the calls you make and build your Fan Report
          around them.
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
        <p className="text-center font-mono text-caption text-smoke">
          You can watch without signing in — sign in to make calls that count.
        </p>
      </div>
    </Sheet>
  );
}
