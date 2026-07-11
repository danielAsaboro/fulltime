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
        <Eyebrow>Peers reconnecting</Eyebrow>
        <h1 className="text-heading text-off-black">You&apos;re offline.</h1>
        <p className="max-w-md font-mono text-body-lg text-graphite">
          FullTime needs a connection to discover peers and refresh signed fixtures. Your local room data
          remains on this device and resumes syncing when peers reconnect.
        </p>
        <Button href="/matches" variant="primary" withArrow>
          Try again
        </Button>
      </Container>
    </div>
  );
}
