"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container, Logo } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/field";

function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const normalized = normalizeCode(code);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalized) return;
    router.push(`/join/${encodeURIComponent(normalized)}`);
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo href="/app" />
          <Button variant="quiet" size="sm" href="/matches">
            Create a room
          </Button>
        </Container>
      </header>

      <Container className="grid min-h-[calc(100dvh-72px)] place-items-center py-12">
        <div className="w-full max-w-lg rounded-[28px] border border-ash bg-parchment p-6 sm:p-10">
          <span className="mb-8 grid size-12 place-items-center rounded-full bg-periwinkle-mist text-off-black">
            <Ticket size={22} strokeWidth={1.7} aria-hidden />
          </span>
          <p className="font-mono text-caption uppercase tracking-[0.14em] text-smoke">Private room</p>
          <h1 className="mt-3 text-heading text-off-black">Join with a code.</h1>
          <p className="mt-4 font-mono text-body-sm text-graphite">
            Paste the code from your invite. You&apos;ll see the room and fixture before joining.
          </p>

          <form className="mt-8 space-y-4" onSubmit={submit}>
            <TextField
              id="room-code"
              label="Invite code"
              placeholder="Paste the full invite code"
              value={code}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={2_048}
              autoFocus
              className="font-mono text-caption"
              onChange={(event) => setCode(event.target.value)}
            />
            <Button type="submit" variant="primary" fullWidth disabled={!normalized}>
              Find the room
              <ArrowRight size={16} strokeWidth={1.8} aria-hidden />
            </Button>
          </form>

          <p className="mt-6 flex items-start gap-2 border-t border-ash pt-5 font-mono text-caption text-smoke">
            <LockKeyhole size={14} className="mt-px shrink-0" strokeWidth={1.8} aria-hidden />
            FullTime rooms are invite-only. A room never appears in a public directory.
          </p>
        </div>
      </Container>
    </div>
  );
}
