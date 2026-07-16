"use client";

import { cn } from "@/lib/cn";
import { authorInitials, authorPalette, avatarGeometry } from "@/lib/author-style";

type Size = "xs" | "sm" | "md" | "lg";

const SIZE_PX: Record<Size, number> = {
  xs: 20,
  sm: 28,
  md: 32,
  lg: 40,
};

/**
 * Deterministic peer avatar — soft geometric mark from userId, not a dull single letter.
 * Same peer always gets the same art on every device.
 */
export function PeerAvatar({
  userId,
  displayName,
  size = "md",
  isCurrentUser = false,
  className,
}: {
  userId?: string | null;
  displayName?: string | null;
  size?: Size;
  isCurrentUser?: boolean;
  className?: string;
}) {
  const px = SIZE_PX[size];
  const seed = userId || displayName || "room";
  const palette = authorPalette(isCurrentUser ? `self:${seed}` : seed);
  const geo = avatarGeometry(seed);
  const label = displayName?.trim() || "Peer";

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border",
        isCurrentUser ? "border-lake-blue ring-2 ring-lake-blue/25" : "border-ash/80",
        className,
      )}
      style={{ width: px, height: px, backgroundColor: palette.bg }}
      title={label}
      aria-hidden
    >
      <svg width={px} height={px} viewBox="0 0 40 40" className="absolute inset-0" role="presentation">
        <rect width="40" height="40" fill={palette.bg} />
        {/* Soft layered shapes — unique per peer, readable at 20px */}
        <circle cx={geo.c1x} cy={geo.c1y} r={geo.c1r} fill={geo.accent} opacity={0.55} />
        <circle cx={geo.c2x} cy={geo.c2y} r={geo.c2r} fill={palette.fg} opacity={0.12} />
        <path d={geo.path} fill={geo.accent} opacity={0.85} />
        <circle cx="20" cy="20" r="18" fill="none" stroke={palette.fg} strokeOpacity={0.08} strokeWidth="2" />
      </svg>
      {/* Tiny monogram for accessibility / familiarity — not the whole identity */}
      <span
        className="relative z-[1] font-mono font-medium leading-none"
        style={{
          fontSize: Math.max(8, Math.round(px * 0.28)),
          color: palette.fg,
          textShadow: "0 0 6px rgba(255,255,255,0.65)",
        }}
      >
        {authorInitials(label)}
      </span>
    </span>
  );
}
