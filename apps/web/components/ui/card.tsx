import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type Surface = "parchment" | "periwinkle" | "ink" | "bare";
type Padding = "none" | "sm" | "md" | "lg" | "card";

const surfaces: Record<Surface, string> = {
  // Elevation is surface + 1px Ash border — never drop shadows (design law).
  parchment: "bg-parchment border border-ash",
  periwinkle: "bg-periwinkle-mist",
  ink: "bg-off-black text-parchment",
  bare: "",
};

const paddings: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
  card: "p-10",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  surface?: Surface;
  padding?: Padding;
}

export function Card({ surface = "parchment", padding = "md", className, ...rest }: CardProps) {
  return (
    <div className={cn("rounded-card", surfaces[surface], paddings[padding], className)} {...rest} />
  );
}
