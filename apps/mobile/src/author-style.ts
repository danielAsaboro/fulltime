/**
 * Deterministic author chrome — same palette/geometry family as web PeerAvatar.
 */

import { hashSeed } from "./peer-identity";

const PALETTE = [
  { bg: "#cfdaf5", fg: "#1a2744", accent: "#2b59d1" },
  { bg: "#a7fccd", fg: "#143528", accent: "#1f9d45" },
  { bg: "#ff9473", fg: "#3a180c", accent: "#f37a0a" },
  { bg: "#ecda98", fg: "#3a3010", accent: "#c9a227" },
  { bg: "#a0b5eb", fg: "#152040", accent: "#2b59d1" },
  { bg: "#f6c6d8", fg: "#3a1524", accent: "#d6409f" },
  { bg: "#c8e6d0", fg: "#1a3320", accent: "#33c758" },
  { bg: "#d4c4f0", fg: "#24183a", accent: "#918df6" },
  { bg: "#f0e6d8", fg: "#2a2118", accent: "#cc6437" },
  { bg: "#d8f0f0", fg: "#143038", accent: "#2c78fc" },
] as const;

export function authorPalette(userId: string | undefined | null): {
  bg: string;
  fg: string;
  accent: string;
} {
  if (!userId) return { bg: "#cecac8", fg: "#242424", accent: "#797776" };
  const h = hashSeed(userId);
  const row = PALETTE[h % PALETTE.length]!;
  return { bg: row.bg, fg: row.fg, accent: row.accent };
}

export function authorInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!)
      .join("")
      .toUpperCase() || "?"
  );
}

/** Geometry knobs for PeerAvatar (stable per seed). */
export function avatarGeometry(seed: string): {
  c1x: number;
  c1y: number;
  c1r: number;
  c2x: number;
  c2y: number;
  c2r: number;
  path: string;
  accent: string;
} {
  const h = hashSeed(seed);
  const palette = authorPalette(seed);
  const c1x = 10 + (h % 12);
  const c1y = 8 + ((h >>> 4) % 14);
  const c1r = 8 + ((h >>> 8) % 10);
  const c2x = 22 + ((h >>> 12) % 10);
  const c2y = 18 + ((h >>> 16) % 12);
  const c2r = 6 + ((h >>> 20) % 8);
  const variant = (h >>> 24) % 4;
  let path: string;
  if (variant === 0) {
    path = "M20 8 L30 28 L10 28 Z";
  } else if (variant === 1) {
    path = "M12 12 H28 V28 H12 Z";
  } else if (variant === 2) {
    path = "M20 10 L28 20 L20 30 L12 20 Z";
  } else {
    path = "M14 14 Q20 8 26 14 Q32 20 26 26 Q20 32 14 26 Q8 20 14 14 Z";
  }
  return { c1x, c1y, c1r, c2x, c2y, c2r, path, accent: palette.accent };
}
