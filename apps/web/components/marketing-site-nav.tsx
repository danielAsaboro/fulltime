import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container, Logo } from "@/components/ui/primitives";

const LINKS = [
  { href: "#why-fulltime", label: "Why FullTime" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#questions", label: "Questions" },
];

export function MarketingSiteNav() {
  return (
    <header>
      <Container className="flex h-[96px] items-center justify-between gap-6 xl:h-[112px]">
        <div className="flex items-center gap-10">
          <Logo />
          <nav aria-label="Marketing" className="hidden items-center gap-8 xl:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link rounded-sm font-mono text-body uppercase tracking-[0.02em] text-off-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lake-blue"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <Button href="https://github.com/winsznx/fulltime" variant="primary" size="sm" withArrow>
          View source
        </Button>
      </Container>
    </header>
  );
}
