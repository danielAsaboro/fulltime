export type MobileLinkPreview =
  | { kind: "x"; url: string; title: string; authorName: string; authorUrl: string; text: string; html: string }
  | { kind: "link"; url: string; title: string; description: string | null; siteName: string; imageUrl: string | null };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[),.!?:;\]}]+$/u;

export function externalLinks(text: string, limit = 2): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const value = match[0].replace(TRAILING_PUNCTUATION, "");
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      url.hash = "";
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
      if (links.length === limit) break;
    } catch { /* Malformed chat text remains plain text. */ }
  }
  return links;
}

export async function fetchMobileLinkPreview(endpoint: string, url: string, signal?: AbortSignal): Promise<MobileLinkPreview> {
  const target = new URL(endpoint);
  target.searchParams.set("url", url);
  const response = await fetch(target, { signal, headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null) as MobileLinkPreview | { error?: string } | null;
  if (!response.ok) throw new Error(payload && "error" in payload ? payload.error : `Preview failed with HTTP ${response.status}`);
  if (!payload || !("kind" in payload) || (payload.kind !== "x" && payload.kind !== "link")) throw new Error("Preview service returned invalid data");
  return payload;
}
