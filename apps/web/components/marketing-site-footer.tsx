import Link from "next/link";

import { Container, Logo } from "@/components/ui/primitives";

export function MarketingSiteFooter({ downloadsAvailable = false }: { downloadsAvailable?: boolean }) {
  return (
    <footer className="border-t border-ash">
      <Container className="flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <nav aria-label="Marketing footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="#how-it-works"
            className="min-h-10 rounded-sm py-3 font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lake-blue"
          >
            How it works
          </Link>
          {downloadsAvailable ? (
            <Link
              href="#download"
              className="min-h-10 rounded-sm py-3 font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lake-blue"
            >
              Download
            </Link>
          ) : null}
          <Link
            href="https://github.com/danielAsaboro/fulltime"
            className="min-h-10 rounded-sm py-3 font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lake-blue"
          >
            Source
          </Link>
        </nav>
        <p className="font-mono text-caption text-smoke">Encrypted rooms powered by Pear</p>
      </Container>
    </footer>
  );
}
