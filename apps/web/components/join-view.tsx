"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Users } from "lucide-react";

import { useData, useRoomByInvite } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { TextField } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";
import { Scoreline } from "@/components/scoreline";

export function JoinView({ code, referrerUserId }: { code: string; referrerUserId?: string }) {
  const invite = useRoomByInvite(code);
  const { client, session, signIn } = useData();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const join = async () => {
    if (busy || (!session && !displayName.trim())) return;
    setBusy(true);
    setJoinError(null);
    try {
      if (!session) await signIn(displayName.trim());
      const joined = await client.joinRoom(code, referrerUserId);
      router.push(`/room/${joined.room.id}`);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "That invite could not be used.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo />
          <Button variant="quiet" size="sm" href="/join" className="px-2.5 sm:px-5">
            New code
          </Button>
        </Container>
      </header>

      <Container className="py-16">
        <div className="mx-auto max-w-xl">
          {invite.status === "loading" ? (
            <Skeleton className="h-80 w-full rounded-card" />
          ) : invite.status === "error" ? (
            <ErrorState hint={invite.error ?? undefined} onRetry={invite.reload} />
          ) : invite.status === "empty" || !invite.data ? (
            <EmptyState
              title="Invite not found"
              hint={`“${code}” is invalid, expired, or has been revoked. Ask the room creator for a fresh invite.`}
              action={<Button href="/join" variant="ghost" size="sm">Try another code</Button>}
            />
          ) : (
            <InvitePreview
              roomName={invite.data.room.name}
              fixture={invite.data.fixture}
              members={invite.data.members}
              displayName={session?.displayName ?? displayName}
              signedIn={Boolean(session)}
              busy={busy}
              error={joinError}
              onDisplayNameChange={setDisplayName}
              onJoin={() => void join()}
            />
          )}
        </div>
      </Container>
    </div>
  );
}

function InvitePreview({
  roomName,
  fixture,
  members,
  displayName,
  signedIn,
  busy,
  error,
  onDisplayNameChange,
  onJoin,
}: {
  roomName: string;
  fixture: import("@fulltime/shared").Fixture;
  members: number;
  displayName: string;
  signedIn: boolean;
  busy: boolean;
  error: string | null;
  onDisplayNameChange: (name: string) => void;
  onJoin: () => void;
}) {
  return (
    <div className="space-y-8">
      <div className="space-y-3 text-center">
        <span className="inline-flex justify-center"><Tag tone="muted">Invite-only room</Tag></span>
        <h1 className="text-heading text-off-black">You&apos;re invited to {roomName}</h1>
        <p className="font-mono text-body-lg text-graphite">
          Watch along, make calls, and share the receipts with the group.
        </p>
      </div>

      <div className="rounded-[28px] border border-ash bg-parchment p-6">
        <Scoreline
          home={fixture.home}
          away={fixture.away}
          score={fixture.score ?? null}
          status={fixture.status}
          minute={fixture.minute ?? null}
        />
        <p className="mt-5 flex items-center gap-2 border-t border-ash pt-4 font-mono text-caption uppercase tracking-[0.1em] text-smoke">
          <Users size={14} strokeWidth={1.8} aria-hidden />
          {members.toLocaleString()} {members === 1 ? "member" : "members"} · reactions and calls anchored to the match
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {signedIn ? (
          <div className="flex items-center justify-between rounded-lg border border-ash px-4 py-3">
            <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Joining as</span>
            <span className="font-mono text-body-sm text-off-black">{displayName}</span>
          </div>
        ) : (
          <TextField
            id="join-display-name"
            label="Your display name"
            placeholder="e.g. Amina"
            value={displayName}
            maxLength={24}
            autoComplete="nickname"
            onChange={(event) => onDisplayNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onJoin();
            }}
          />
        )}
        {error ? (
          <p className="font-mono text-body-sm text-crimson" role="alert">{error}</p>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          onClick={onJoin}
          disabled={busy || (!signedIn && !displayName.trim())}
        >
          {busy ? "Joining…" : "Join room"}
          {busy ? null : <ArrowRight size={16} strokeWidth={1.8} aria-hidden />}
        </Button>
        <p className="flex items-center justify-center gap-2 text-center font-mono text-caption text-smoke">
          <LockKeyhole size={13} strokeWidth={1.8} aria-hidden />
          Only people with an active invite can enter.
        </p>
      </div>
    </div>
  );
}
