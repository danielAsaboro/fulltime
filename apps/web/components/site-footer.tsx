import Link from "next/link";

import { Container, Logo } from "@/components/ui/primitives";

export function SiteFooter() {
  return (
    <footer className="border-t border-ash">
      <Container className="flex flex-col gap-4 py-10 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            { href: "/matches", label: "Matches" },
            { href: "/record", label: "Record" },
            { href: "/replay/9001", label: "Replay" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-mono text-caption uppercase tracking-[0.1em] text-smoke hover:text-off-black"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="font-mono text-caption text-smoke">Powered by TxLINE · World Cup 2026</p>
      </Container>
    </footer>
  );
}
