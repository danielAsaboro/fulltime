import { Button } from "@/components/ui/button";
import { Container, Eyebrow, Logo } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-ash">
        <Container className="flex h-[72px] items-center">
          <Logo />
        </Container>
      </header>
      <Container className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 py-20 text-center">
        <Eyebrow>404 · off the pitch</Eyebrow>
        <h1 className="text-heading text-off-black">This page isn&apos;t in play.</h1>
        <p className="max-w-md font-mono text-body-lg text-graphite">
          The link may have expired or the room has closed. Head back to the fixtures.
        </p>
        <Button href="/matches" variant="primary" withArrow>
          See matches
        </Button>
      </Container>
    </div>
  );
}
