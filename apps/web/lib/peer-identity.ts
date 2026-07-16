/**
 * Automatic peer display names — "dancing meadow" style.
 * Short, readable, Title Case for room chrome. Deterministic option from seed.
 */

const ADJECTIVES = [
  "dancing",
  "quiet",
  "swift",
  "golden",
  "silver",
  "hidden",
  "bright",
  "calm",
  "wild",
  "gentle",
  "lucky",
  "noble",
  "proud",
  "clever",
  "brave",
  "merry",
  "cosmic",
  "amber",
  "coral",
  "mint",
  "violet",
  "crystal",
  "velvet",
  "steady",
  "radiant",
  "misty",
  "sunny",
  "ember",
  "lunar",
  "solar",
  "northern",
  "southern",
  "eastern",
  "western",
  "rising",
  "falling",
  "ancient",
  "modern",
  "honest",
  "keen",
  "bold",
  "soft",
  "sharp",
  "vivid",
  "clear",
  "deep",
  "high",
  "low",
  "true",
] as const;

const NOUNS = [
  "meadow",
  "river",
  "harbor",
  "falcon",
  "cedar",
  "orchard",
  "comet",
  "lantern",
  "bridge",
  "horizon",
  "echo",
  "ember",
  "harbor",
  "willow",
  "pine",
  "oak",
  "stone",
  "wave",
  "current",
  "spark",
  "signal",
  "pitch",
  "whistle",
  "corner",
  "striker",
  "keeper",
  "midfield",
  "terrace",
  "stadium",
  "banner",
  "scarf",
  "kit",
  "boot",
  "net",
  "goal",
  "pass",
  "cross",
  "volley",
  "header",
  "bench",
  "crowd",
  "roar",
  "pulse",
  "tempo",
  "rhythm",
  "chord",
  "verse",
  "chapter",
  "atlas",
  "compass",
] as const;

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T extends readonly string[]>(list: T, n: number): T[number] {
  return list[n % list.length]!;
}

/** Random human-friendly name for sign-in (user can regenerate). */
export function generateDisplayName(random: () => number = Math.random): string {
  const a = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]!;
  const n = NOUNS[Math.floor(random() * NOUNS.length)]!;
  return formatDisplayName(a, n);
}

/** Stable name from any id string (for previews tied to peer id if needed). */
export function displayNameFromSeed(seed: string): string {
  const h = hashSeed(seed || "fulltime");
  return formatDisplayName(pick(ADJECTIVES, h), pick(NOUNS, h >>> 16));
}

function formatDisplayName(adjective: string, noun: string): string {
  const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  return `${title(adjective)} ${title(noun)}`;
}

export { hashSeed };
