"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { Flag } from "@/components/ui/flag";

export interface ShareStat { label: string; value: string; }

export function ShareCard({ eyebrow, title, scoreline, flags, stats, tagline, className }: {
  eyebrow: string;
  title: string;
  scoreline?: string;
  flags?: { home?: string | null; away?: string | null };
  stats?: ShareStat[];
  tagline?: string;
  className?: string;
}) {
  return <div className={cn("rounded-card bg-periwinkle-mist p-8 sm:p-10", className)}><div className="flex items-center justify-between"><p className="font-mono text-caption uppercase tracking-[0.14em] text-off-black/70">{eyebrow}</p><span className="font-mono text-caption uppercase tracking-[0.1em] text-off-black/70">● FullTime</span></div><h3 className="mt-6 text-heading text-off-black">{title}</h3>{scoreline ? <div className="mt-3 flex items-center gap-2.5">{flags?.home ? <Flag code={flags.home} size={22} /> : null}<p className="font-mono text-body-lg font-medium tabular text-off-black">{scoreline}</p>{flags?.away ? <Flag code={flags.away} size={22} /> : null}</div> : null}{stats?.length ? <div className="mt-8 grid grid-cols-3 gap-4">{stats.map((stat) => <div key={stat.label}><p className="font-mono text-caption uppercase tracking-[0.08em] text-off-black/60">{stat.label}</p><p className="font-mono text-subheading font-medium tabular leading-none text-off-black">{stat.value}</p></div>)}</div> : null}{tagline ? <p className="mt-8 text-subheading text-off-black">{tagline}</p> : null}</div>;
}

export function CopyLinkButton({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  };
  return <button type="button" onClick={() => void copy()} className={cn("rounded-btn border border-off-black px-6 py-3 font-mono text-body-sm uppercase tracking-[0.06em] text-off-black hover:bg-off-black hover:text-parchment", className)}>{copied ? "Link copied ✓" : "Copy share link"}</button>;
}
