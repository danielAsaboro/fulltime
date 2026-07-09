"use client";

import Link from "next/link";
import { useState } from "react";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, Logo } from "@/components/ui/primitives";
import { SignInModal } from "@/components/sign-in-modal";

const LINKS = [
  { href: "/matches", label: "Matches" },
  { href: "/record", label: "Record" },
];

export function SiteNav({ border = false }: { border?: boolean }) {
  const { session } = useData();
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <header className={border ? "border-b border-ash" : undefined}>
      <Container className="flex h-[72px] items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-6 sm:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-mono text-body-sm uppercase tracking-[0.06em] text-graphite hover:text-off-black"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {session ? (
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-mint" aria-hidden />
            <span className="font-mono text-body-sm text-off-black">{session.displayName}</span>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setSignInOpen(true)}>
            Sign in
          </Button>
        )}
      </Container>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </header>
  );
}
