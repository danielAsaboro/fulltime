import type { Metadata } from "next";

import { Container, Eyebrow } from "@/components/ui/primitives";
import { RecordView } from "@/components/record-view";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Tournament record — FullTime",
  description: "Every call you've made across the tournament, each with its receipt.",
};

export default function RecordPage() {
  return (
    <>
      <SiteNav border />
      <main>
        <Container className="pt-12">
          <div className="mx-auto max-w-4xl space-y-3">
            <Eyebrow>Your tournament</Eyebrow>
            <h1 className="text-heading text-off-black">Tournament record</h1>
            <p className="font-mono text-body-lg text-graphite">
              Bragging rights nobody can fake — every scored call carries the receipt behind it.
            </p>
          </div>
        </Container>
        <RecordView />
      </main>
      <SiteFooter />
    </>
  );
}
