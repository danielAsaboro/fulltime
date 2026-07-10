"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play } from "lucide-react";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, Logo } from "@/components/ui/primitives";

export function DemoEntry() {
  const { enterDemoRoom } = useData();
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const enter = () => {
    setError(null);
    void enterDemoRoom()
      .then((room) => router.replace(`/room/${room.room.id}?demo=1`))
      .catch((reason: unknown) => {
        started.current = false;
        setError(reason instanceof Error ? reason.message : "The demo room could not be opened.");
      });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    enter();
    // The bootstrap is intentionally run once for this route visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-dvh bg-parchment">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center">
          <Logo />
        </Container>
      </header>

      <Container className="grid min-h-[calc(100dvh-72px)] place-items-center py-16">
        <div className="w-full min-w-0 max-w-lg text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full border border-ash bg-white/40">
            {error ? (
              <Play className="size-5 text-off-black" fill="currentColor" aria-hidden />
            ) : (
              <LoaderCircle className="size-5 animate-spin text-lake-blue" aria-hidden />
            )}
          </span>
          <p className="mt-6 font-mono text-caption uppercase tracking-[0.12em] text-smoke">
            End-to-end room demo
          </p>
          <h1 className="mt-3 text-heading-sm text-off-black">
            {error ? "The room did not open" : "Taking you to France vs Morocco"}
          </h1>
          <p className="mt-4 font-mono text-body-sm text-graphite">
            {error
              ? error
              : "You’ll enter before kick-off, then watch the chat, calls, polls, events, receipts, and final whistle arrive live."}
          </p>
          {error ? (
            <Button
              type="button"
              variant="primary"
              className="mt-7"
              onClick={() => {
                if (started.current) return;
                started.current = true;
                enter();
              }}
            >
              Try again
            </Button>
          ) : null}
        </div>
      </Container>
    </div>
  );
}
