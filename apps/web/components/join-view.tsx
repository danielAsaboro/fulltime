"use client";

import { useState } from "react";

import { useData, useRoomByInvite, useRoomState } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { Tag } from "@/components/ui/tag";
import { Scoreline } from "@/components/scoreline";
import { SignInModal } from "@/components/sign-in-modal";

export function JoinView({ code }: { code: string }) {
  const invite = useRoomByInvite(code);
  const { session } = useData();
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center justify-between">
          <Logo />
          <Button variant="ghost" size="sm" href="/matches">
            Browse matches
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
              hint={`We couldn't find a room for "${code}". Ask for a fresh invite link, or browse open matches.`}
              action={<Button href="/matches" variant="ghost" size="sm">See matches</Button>}
            />
          ) : (
            <InvitePreview
              roomId={invite.data.room.id}
              roomName={invite.data.room.name}
              fixtureHome={invite.data.fixture.home}
              fixtureAway={invite.data.fixture.away}
              crowd={invite.data.crowd}
              signedIn={Boolean(session)}
              onSignIn={() => setSignInOpen(true)}
            />
          )}
        </div>
      </Container>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}

function InvitePreview({
  roomId,
  roomName,
  fixtureHome,
  fixtureAway,
  crowd,
  signedIn,
  onSignIn,
}: {
  roomId: string;
  roomName: string;
  fixtureHome: import("@fulltime/shared").Team;
  fixtureAway: import("@fulltime/shared").Team;
  crowd: number;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const live = useRoomState(roomId);
  const state = live.data;

  return (
    <div className="space-y-8">
      <div className="space-y-3 text-center">
        <span className="inline-flex justify-center"><Tag tone="muted">Private room</Tag></span>
        <h1 className="text-heading text-off-black">You&apos;re invited to {roomName}</h1>
        <p className="font-mono text-body-lg text-graphite">
          Watch along, make calls, and share the receipts with the group.
        </p>
      </div>

      <div className="rounded-card border border-ash bg-parchment p-6">
        <Scoreline
          home={fixtureHome}
          away={fixtureAway}
          score={state?.fixtureState.score ?? null}
          status={state?.fixtureState.status ?? "scheduled"}
          minute={state?.fixtureState.minute ?? null}
        />
        <p className="mt-4 font-mono text-caption uppercase tracking-[0.1em] text-smoke">
          {crowd.toLocaleString()} watching · reactions and calls anchored to the match
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {signedIn ? (
          <Button href={`/room/${roomId}`} variant="primary" fullWidth withArrow>
            Enter the room
          </Button>
        ) : (
          <Button variant="primary" fullWidth onClick={onSignIn}>
            Sign in to join
          </Button>
        )}
        <Button href={`/room/${roomId}`} variant="ghost" fullWidth>
          Peek read-only first
        </Button>
        <p className="text-center font-mono text-caption text-smoke">
          Previewing is free — sign in only when you want to make calls that count.
        </p>
      </div>
    </div>
  );
}
