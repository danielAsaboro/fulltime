import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Container, Eyebrow, Logo } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Offline — FullTime",
};

export default function OfflinePage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center">
          <Logo />
        </Container>
      </header>
      <Container className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 py-20 text-center">
        <Eyebrow>Feed reconnecting</Eyebrow>
        <h1 className="text-heading text-off-black">You&apos;re offline.</h1>
        <p className="max-w-md font-mono text-body-lg text-graphite">
          FullTime needs a connection for live match data. Your calls and receipts are safe — reconnect
          and the room picks up right where it left off.
        </p>
        <Button href="/matches" variant="primary" withArrow>
          Try again
        </Button>
      </Container>
    </div>
  );
}
