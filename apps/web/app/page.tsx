import Image from "next/image";
import Link from "next/link";
import { Play, Plus, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, Eyebrow } from "@/components/ui/primitives";
import { AnnouncementBar } from "@/components/announcement-bar";
import { Faq } from "@/components/faq";
import { LiveStrip } from "@/components/live-strip";
import { MatchSyncFeature } from "@/components/match-sync-feature";
import { PipelineDiagram } from "@/components/pipeline-diagram";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

const BUILT_ON = ["TxLINE", "Solana", "Next.js", "World Cup 2026"];

const FEATURES = [
  {
    glyph: "◑",
    title: "It won't spoil you",
    body: "Tell FullTime where your stream is and every goal, call, and reaction releases on your clock. An 8-second delay and a 42-second delay share one room, no spoilers.",
  },
  {
    glyph: "✓",
    title: "Proof nobody can fake",
    body: "Your calls settle from verified match data and earn receipts. When the batch anchors, the checkmark lands. Pending is honest — we never fake a checkmark.",
  },
  {
    glyph: "◇",
    title: "The room, not a group chat",
    body: "Reactions, notes, and quick calls anchor to the actual match timeline. The group-chat feeling, wired to what just happened on the pitch.",
  },
];

const STEPS = [
  { n: "01", label: "Join", body: "Tap a match, pick a name, you're in the room." },
  { n: "02", label: "Calibrate", body: "Set your stream delay once. Two taps." },
  { n: "03", label: "Call it", body: "Rapid-fire predictions that settle from data." },
  { n: "04", label: "Keep the proof", body: "A Fan Report and receipts you can brag with." },
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
                  Private rooms · Spoiler-safe · World Cup 2026
                </p>
                <h1 className="hero-title text-parchment">
                  Your match.<br />Your people. Your clock.
                </h1>
                <p className="mt-6 max-w-[620px] font-mono text-body text-parchment/80 sm:text-body-lg">
                  Create an invite-only room for any fixture. Chat through every moment, make calls that
                  settle from verified data, and see each reaction when it reaches <em>your</em> stream.
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
                <Link
                  href="/demo"
                  className="mt-5 inline-flex w-fit items-center gap-2 font-mono text-caption uppercase tracking-[0.1em] text-parchment/75 transition-colors hover:text-parchment"
                >
                  <Play size={14} fill="currentColor" strokeWidth={1.5} aria-hidden />
                  Watch a full match unfold
                </Link>
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

        {/* MatchSync — the elevated Periwinkle feature */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <MatchSyncFeature />
          </Container>
        </section>

        {/* Why it's different */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="max-w-2xl space-y-3">
              <Eyebrow>Why FullTime</Eyebrow>
              <h2 className="text-heading-sm text-off-black">
                A goal hits the feed once. Every fan sees the room react at the right moment.
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

        {/* Pipeline — how the data flows */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="max-w-2xl space-y-3">
              <Eyebrow>Load-bearing TxLINE</Eyebrow>
              <h2 className="text-heading-sm text-off-black">
                Verified live data in. Playable, provable moments out.
              </h2>
              <p className="font-mono text-body-lg text-graphite">
                Scores, odds, and events are normalized to one canonical, message-ordered state — then
                fan out to the room as calls that settle, Market Says context, and receipts you can verify.
              </p>
            </div>
            <div className="mt-12">
              <PipelineDiagram />
            </div>
          </Container>
        </section>

        {/* How it works */}
        <section className="border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="max-w-2xl space-y-3">
              <Eyebrow>One loop, start to finish</Eyebrow>
              <h2 className="text-heading-sm text-off-black">Join, calibrate, play, keep the proof.</h2>
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
                TxLINE turns live sports into verifiable state. FullTime plays it.
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
