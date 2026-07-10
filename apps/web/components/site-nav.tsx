"use client";

import Link from "next/link";
import { useState } from "react";

import { useData } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Container, Logo } from "@/components/ui/primitives";
import { SignInModal } from "@/components/sign-in-modal";

const LINKS = [
  { href: "/matches", label: "Matches" },
  { href: "/replay/9001", label: "Replay" },
  { href: "/record", label: "Record" },
];

export function SiteNav({ border = false }: { border?: boolean }) {
  const { session } = useData();
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <header className={border ? "border-b border-ash" : undefined}>
      <Container className="flex h-[96px] items-center justify-between gap-6 lg:h-[112px]">
        <div className="flex items-center gap-10">
          <Logo />
          <nav className="hidden items-center gap-8 lg:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link font-mono text-body uppercase tracking-[0.02em] text-off-black"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {session ? (
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-mint" aria-hidden />
              <span className="font-mono text-body-sm text-off-black">{session.displayName}</span>
            </div>
          ) : (
            <span className="hidden sm:inline-flex">
              <Button variant="secondary" size="sm" onClick={() => setSignInOpen(true)}>
                Sign in
              </Button>
            </span>
          )}
          <Button href="/matches" variant="primary" size="sm" withArrow className="hidden sm:inline-flex">
            Enter a room
          </Button>
        </div>
      </Container>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </header>
  );
}
