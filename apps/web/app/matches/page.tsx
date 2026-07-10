import type { Metadata } from "next";

import { Container, Eyebrow } from "@/components/ui/primitives";
import { MatchesIndex } from "@/components/matches-index";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Create a room — FullTime",
  description: "Choose a World Cup fixture and create an invite-only match room.",
};

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string | string[] }>;
}) {
  const fixtureParam = (await searchParams).fixture;
  const initialFixtureId = Array.isArray(fixtureParam) ? fixtureParam[0] : fixtureParam;

  return (
    <>
      <SiteNav border />
      <main>
        <Container className="py-12 sm:py-16">
          <div className="mb-10 max-w-2xl space-y-3">
            <Eyebrow>Invite-only match rooms</Eyebrow>
            <h1 className="text-heading text-off-black">Create a room.</h1>
            <p className="font-mono text-body-lg text-graphite">
              Pick the fixture your group is watching, name the room, then send the private invite.
            </p>
          </div>
          <MatchesIndex initialFixtureId={initialFixtureId} />
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
