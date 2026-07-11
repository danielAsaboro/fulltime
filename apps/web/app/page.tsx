import Image from "next/image";
import { Plus, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, Eyebrow } from "@/components/ui/primitives";
import { AnnouncementBar } from "@/components/announcement-bar";
import { Faq } from "@/components/faq";
import { LiveStrip } from "@/components/live-strip";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

const BUILT_ON = ["Pear", "Hyperswarm", "Autobase", "Hypercore", "Next.js"];

const FEATURES = [
  {
    glyph: "⌘",
    title: "Peer to peer",
    body: "Room history replicates between members through Hyperswarm and Autobase. There is no central chat database in the message path.",
  },
  {
    glyph: "◇",
    title: "Invite controlled",
    body: "Blind pairing admits a signed peer writer. Revoked invites stop new joins, and creator controls govern membership and slow mode.",
  },
  {
    glyph: "◎",
    title: "Built for the match",
    body: "Choose a fixture from the signed feed, then keep its conversation, polls, reactions, replies, and member list together in one private room.",
  },
];

const STEPS = [
  { n: "01", label: "Pick", body: "Choose a fixture from the signed fixture feed." },
  { n: "02", label: "Create", body: "Name the room and create your local peer identity." },
  { n: "03", label: "Invite", body: "Share the signed invite link or QR code." },
  { n: "04", label: "Chat", body: "Messages, polls, replies, and reactions sync across peers." },
];

export default function Home() {
  return (
    <>
      <AnnouncementBar />
      <SiteNav />

      <main>
        {/* Hero artwork is an original FullTime asset generated for this product. */}
        <section className="hero-shell">
          <Container className="py-5 sm:py-8">
            <div className="relative min-h-[620px] overflow-hidden rounded-[28px] bg-off-black sm:min-h-[680px] lg:min-h-[720px]">
              <Image
                src="/images/fulltime-football-hero.png"
                alt="Two footballers contesting a header under stadium lights"
                fill
                priority
                sizes="(max-width: 767px) 100vw, 1432px"
                className="object-cover object-[63%_center] grayscale sm:object-center"
              />
              <div
                className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,.84)_0%,rgba(0,0,0,.56)_43%,rgba(0,0,0,.08)_75%),linear-gradient(0deg,rgba(0,0,0,.62)_0%,transparent_50%)]"
                aria-hidden
              />
              <div className="relative z-10 flex min-h-[620px] max-w-[690px] flex-col justify-end px-6 py-9 sm:min-h-[680px] sm:px-12 sm:py-12 lg:min-h-[720px] lg:px-16 lg:py-16">
                <p className="mb-5 font-mono text-caption uppercase tracking-[0.14em] text-parchment/70">
                  Encrypted rooms · Peer to peer · Invite only
                </p>
                <h1 className="hero-title text-parchment">
                  Your match.<br />Your people. Your peers.
                </h1>
                <p className="mt-6 max-w-[620px] font-mono text-body text-parchment/80 sm:text-body-lg">
                  Choose a signed fixture, create an encrypted Pear room, and invite the people you want
                  beside you. Messages, polls, replies, and reactions replicate directly between members.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button href="/matches" variant="primary" className="sm:min-w-48">
                    <Plus size={17} strokeWidth={1.8} aria-hidden />
                    Create a room
                  </Button>
                  <Button
                    href="/join"
                    variant="ghost"
                    className="border-parchment text-parchment hover:bg-parchment hover:text-off-black sm:min-w-48"
                  >
                    <Ticket size={17} strokeWidth={1.8} aria-hidden />
                    Join with code
                  </Button>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Built-on credibility strip */}
        <section className="border-t border-ash">
          <Container className="flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:gap-10">
            <span className="font-mono text-caption uppercase tracking-[0.14em] text-smoke">Built on</span>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {BUILT_ON.map((name) => (
                <span key={name} className="font-mono text-body-sm uppercase tracking-[0.06em] text-smoke">
                  {name}
                </span>
              ))}
            </div>
          </Container>
        </section>

        {/* Live fixtures — private rooms are created from this public schedule. */}
        <section className="border-t border-ash">
          <Container className="py-14">
            <LiveStrip />
          </Container>
        </section>

        {/* Why it's different */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="max-w-2xl space-y-3">
              <Eyebrow>Why FullTime</Eyebrow>
              <h2 className="text-heading-sm text-off-black">
                Private match chat without a central room database.
              </h2>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <Card key={f.title} padding="card" className="space-y-4">
                  <span className="inline-flex text-body-lg text-off-black" aria-hidden>
                    {f.glyph}
                  </span>
                  <h3 className="text-subheading text-off-black">{f.title}</h3>
                  <p className="font-mono text-body-sm text-graphite">{f.body}</p>
                </Card>
              ))}
            </div>
          </Container>
        </section>

        {/* How it works */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="max-w-2xl space-y-3">
              <Eyebrow>One loop, start to finish</Eyebrow>
              <h2 className="text-heading-sm text-off-black">Pick, create, invite, chat.</h2>
            </div>
            <ol className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="space-y-3 border-t border-ash pt-4">
                  <p className="font-mono text-caption tabular tracking-[0.1em] text-smoke">{s.n}</p>
                  <p className="text-subheading text-off-black">{s.label}</p>
                  <p className="font-mono text-body-sm text-graphite">{s.body}</p>
                </li>
              ))}
            </ol>
          </Container>
        </section>

        {/* FAQ */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-[320px_1fr]">
              <div className="space-y-3">
                <Eyebrow>Questions</Eyebrow>
                <h2 className="text-heading-sm text-off-black">The honest answers.</h2>
              </div>
              <Faq />
            </div>
          </Container>
        </section>

        {/* Closing */}
        <section className="border-t border-ash">
          <Container className="py-20">
            <div className="rounded-card bg-off-black px-8 py-14 text-parchment sm:px-14">
              <h2 className="max-w-3xl text-heading-sm text-parchment">
                Bring the group chat to the match — and keep the room on your peers.
              </h2>
              <div className="mt-8">
                <Button href="/matches" variant="primary" withArrow>
                  Create a room
                </Button>
              </div>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
