const COUNTRY_ALIASES: Record<string, string> = {
  EN: "GB-ENG",
  ENG: "GB-ENG",
  ENGLAND: "GB-ENG",
  "GB-ENG": "GB-ENG",
  NOR: "NO",
  NORWAY: "NO",
};

export function normalizeCountryCode(value?: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (!code) return null;
  const normalized = COUNTRY_ALIASES[code] ?? code;
  return normalized === "GB-ENG" || /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function countryFlag(value?: string | null, teamName?: string | null): string | null {
  const code = normalizeCountryCode(value) ?? normalizeCountryCode(teamName);
  if (!code) return null;
  if (code === "GB-ENG") return "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
  return [...code].map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join("");
}
