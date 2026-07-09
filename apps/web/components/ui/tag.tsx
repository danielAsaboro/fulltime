import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tone = "default" | "solid" | "live" | "muted";

const tones: Record<Tone, string> = {
  default: "border border-ash text-graphite",
  solid: "bg-off-black text-parchment",
  live: "border border-ash text-off-black",
  muted: "bg-periwinkle-mist text-off-black",
};

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: "live" | "mint" | "coral" | "smoke" | null;
  children: ReactNode;
}

const dotColor: Record<NonNullable<TagProps["dot"]>, string> = {
  live: "bg-crimson",
  mint: "bg-mint",
  coral: "bg-coral",
  smoke: "bg-smoke",
};

export function Tag({ tone = "default", dot = null, className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-3 py-1 font-mono text-caption uppercase tracking-[0.08em]",
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot ? (
        <span
          className={cn(
            "inline-block size-1.5 rounded-full",
            dotColor[dot],
            dot === "live" && "animate-pulse",
          )}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}
