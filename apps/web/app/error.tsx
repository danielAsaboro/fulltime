"use client";

import { Button } from "@/components/ui/button";
import { Container, Eyebrow, Logo } from "@/components/ui/primitives";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center">
          <Logo />
        </Container>
      </header>
      <Container className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 py-20 text-center">
        <Eyebrow>Room reconnecting</Eyebrow>
        <h1 className="text-heading text-off-black">Something dropped out.</h1>
        <p className="max-w-md font-mono text-body-lg text-graphite">
          We hit a snag rendering this view. Try again to reconnect the Pear room.
        </p>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      </Container>
    </div>
  );
}
