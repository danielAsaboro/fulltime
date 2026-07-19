import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, Eyebrow } from "@/components/ui/primitives";
import { AnnouncementBar } from "@/components/announcement-bar";
import { DownloadSection } from "@/components/download-section";
import { Faq } from "@/components/faq";
import { MarketingSiteFooter } from "@/components/marketing-site-footer";
import { MarketingSiteNav } from "@/components/marketing-site-nav";
import { fullTimeDownloads } from "@/lib/downloads";

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
  const downloads = fullTimeDownloads();

  return (
    <>
      <AnnouncementBar />
      <MarketingSiteNav downloadsAvailable={downloads.length > 0} />

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
                  <Button href="#how-it-works" variant="primary" className="sm:min-w-48">
                    How it works
                  </Button>
                  <Button
                    href="https://github.com/danielAsaboro/fulltime"
                    variant="ghost"
                    className="border-parchment text-parchment hover:bg-parchment hover:text-off-black sm:min-w-48"
                  >
                    View source
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

        {/* Why it's different */}
        <section id="why-fulltime" className="scroll-mt-6 border-t border-ash">
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

        {/* Real product proof captured from the connected desktop, iPhone, and Android apps. */}
        <section id="room-in-action" className="scroll-mt-6 border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
              <div className="max-w-3xl space-y-3">
                <Eyebrow>The room in action</Eyebrow>
                <h2 className="text-heading-sm text-off-black">One encrypted room. Every screen.</h2>
              </div>
              <p className="font-mono text-body-sm text-graphite">
                A real Norway–England room replicated across three admitted peers—with durable chat, a
                room poll, votes, and reactions visible on desktop, iPhone, and Android.
              </p>
            </div>

            <div className="relative mt-10 lg:pb-20 lg:pr-52">
              <div className="overflow-hidden rounded-card border border-ash bg-parchment">
                <Image
                  src="/images/fulltime-desktop-room.png"
                  alt="FullTime desktop room for Norway versus England with three members and a voted first-scorer poll"
                  width={1152}
                  height={768}
                  sizes="(max-width: 1023px) 100vw, 1100px"
                  className="h-auto w-full"
                />
              </div>
              <div className="mt-7 grid grid-cols-2 items-end gap-3 lg:absolute lg:bottom-0 lg:right-0 lg:mt-0 lg:flex lg:items-end">
                <div className="overflow-hidden rounded-[36px] shadow-lg lg:w-[190px]">
                  <Image
                    src="/images/fulltime-mobile-room.png"
                    alt="The Norway versus England FullTime room on iPhone with chat, reactions, and the poll"
                    width={346}
                    height={760}
                    sizes="(max-width: 1023px) 45vw, 190px"
                    className="h-auto w-full"
                  />
                </div>
                <div className="overflow-hidden rounded-[24px] shadow-lg lg:w-[210px]">
                  <Image
                    src="/images/fulltime-android-room.png"
                    alt="The same FullTime room on Android with three peers, chat messages, and reactions"
                    width={720}
                    height={1640}
                    sizes="(max-width: 1023px) 45vw, 210px"
                    className="h-auto w-full"
                  />
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-6 border-t border-ash">
          <Container className="py-16 sm:py-20">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,520px)_1fr] lg:items-end">
              <div className="space-y-3">
                <Eyebrow>One loop, start to finish</Eyebrow>
                <h2 className="text-heading-sm text-off-black">Pick, create, invite, chat.</h2>
              </div>
              <div className="relative aspect-[16/7] overflow-hidden rounded-card bg-off-black">
                <Image
                  src="/images/fulltime-matchday-friends.png"
                  alt="Friends reacting together to a football match beneath the stadium lights"
                  fill
                  sizes="(max-width: 1023px) 100vw, 720px"
                  className="object-cover grayscale"
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,.28),transparent_55%)]" aria-hidden />
              </div>
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

        <DownloadSection downloads={downloads} />

        {/* FAQ */}
        <section id="questions" className="scroll-mt-6 border-t border-ash">
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
            <div className="relative min-h-80 overflow-hidden rounded-card bg-off-black px-8 py-14 text-parchment sm:px-14 sm:py-16">
              <Image
                src="/images/fulltime-closing-stadium.png"
                alt=""
                fill
                sizes="(max-width: 767px) 100vw, 1432px"
                className="object-cover object-[72%_center] sm:object-center"
              />
              <div
                className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,.92)_0%,rgba(0,0,0,.78)_42%,rgba(0,0,0,.18)_78%),linear-gradient(0deg,rgba(0,0,0,.42)_0%,transparent_70%)]"
                aria-hidden
              />
              <div className="relative z-10 max-w-3xl">
                <h2 className="text-heading-sm text-parchment">
                  Bring the group chat to the match — and keep the room on your peers.
                </h2>
                <div className="mt-8">
                  <Button
                    href={downloads.length ? "#download" : "https://github.com/danielAsaboro/fulltime"}
                    variant="primary"
                    withArrow
                  >
                    {downloads.length ? "Download FullTime" : "View source"}
                  </Button>
                </div>
              </div>
            </div>
          </Container>
        </section>
      </main>

      <MarketingSiteFooter downloadsAvailable={downloads.length > 0} />
    </>
  );
}
