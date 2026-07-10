import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { BrandMark } from "./brand-mark";

export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn("font-mono text-caption uppercase tracking-[0.14em] text-smoke", className)}>
      {children}
    </p>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-ash", className)} />;
}

export function Logo({ href = "/", className }: { href?: string | null; className?: string }) {
  const mark = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={40} />
      <span className="font-mono text-label font-medium uppercase tracking-[-0.04em] text-off-black sm:text-[22px]">
        FullTime
      </span>
    </span>
  );
  if (href === null) return mark;
  return (
    <Link href={href} aria-label="FullTime home">
      {mark}
    </Link>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="text-heading-sm text-off-black">{title}</h2>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{label}</p>
      <p className="font-mono text-subheading font-medium tabular text-off-black leading-none">{value}</p>
      {sub ? <p className="font-mono text-caption text-smoke">{sub}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-periwinkle-mist/60", className)} aria-hidden />;
}

export function EmptyState({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-card border border-dashed border-ash px-8 py-16 text-center",
        className,
      )}
    >
      <p className="text-subheading text-off-black">{title}</p>
      {hint ? <p className="max-w-md font-mono text-body-sm text-smoke">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something dropped out",
  hint,
  onRetry,
  className,
}: {
  title?: string;
  hint?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-card border border-ash bg-parchment px-8 py-16 text-center",
        className,
      )}
    >
      <p className="text-subheading text-off-black">{title}</p>
      {hint ? <p className="max-w-md font-mono text-body-sm text-smoke">{hint}</p> : null}
      {onRetry ? (
        <button
          onClick={onRetry}
          className="font-mono text-body-sm uppercase tracking-[0.08em] text-lake-blue hover:underline"
        >
          Try again →
        </button>
      ) : null}
    </div>
  );
}

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full max-w-[var(--page-max-width)] px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}

export function PageShell({ className, children }: { className?: string; children: ReactNode }) {
  return <main className={cn("min-h-dvh", className)}>{children}</main>;
}

export type { HTMLAttributes };
