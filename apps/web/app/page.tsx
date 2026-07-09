import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container, Eyebrow } from "@/components/ui/primitives";
import { LiveStrip } from "@/components/live-strip";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

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
      <SiteNav />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="wash-coral-sky pointer-events-none absolute -top-32 right-0 h-96 w-96 opacity-40" aria-hidden />
          <Container className="relative py-20 sm:py-28">
            <div className="max-w-3xl space-y-6">
              <Eyebrow>Spoiler-safe · World Cup 2026</Eyebrow>
              <h1 className="text-heading sm:text-heading-lg lg:text-display text-off-black">
                The World Cup, on your own clock.
              </h1>
              <p className="max-w-2xl font-mono text-body-lg text-graphite">
                FullTime turns your second screen into a synced match room. Make calls that settle from
                verified data, react to the moments as they reach <em>your</em> stream, and leave with a
                Fan Report nobody can fake.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button href="/matches" variant="primary" withArrow>
                  Find your match
                </Button>
                <Button href="/replay/9001" variant="ghost">
                  Watch a replay
                </Button>
              </div>
            </div>
          </Container>
        </section>

        {/* Live now */}
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
                A goal hits the feed once. Every fan sees the room react at the right moment.
              </h2>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
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

        {/* Closing */}
        <section className="border-t border-ash">
          <Container className="py-20">
            <div className="rounded-card bg-off-black px-8 py-14 text-parchment sm:px-14">
              <h2 className="max-w-3xl text-heading-sm text-parchment">
                TxLINE turns live sports into verifiable state. FullTime plays it.
              </h2>
              <div className="mt-8">
                <Button href="/matches" variant="primary" withArrow>
                  Enter a room
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
