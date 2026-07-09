import type { Metadata } from "next";

import { Container, Eyebrow } from "@/components/ui/primitives";
import { MatchesIndex } from "@/components/matches-index";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Matches — FullTime",
  description: "Every World Cup fixture, each with a live second-screen room.",
};

export default function MatchesPage() {
  return (
    <>
      <SiteNav border />
      <main>
        <Container className="py-12 sm:py-16">
          <div className="mb-10 max-w-2xl space-y-3">
            <Eyebrow>World Cup 2026</Eyebrow>
            <h1 className="text-heading text-off-black">Find your match.</h1>
            <p className="font-mono text-body-lg text-graphite">
              Every fixture gets a room. Jump into a live one, or open an upcoming room before kick-off.
            </p>
          </div>
          <MatchesIndex />
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
