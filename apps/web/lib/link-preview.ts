export type LinkPreview =
  | {
      kind: "x";
      url: string;
      title: string;
      authorName: string;
      authorUrl: string;
      text: string;
      html: string;
    }
  | {
      kind: "link";
      url: string;
      title: string;
      description: string | null;
      siteName: string;
      imageUrl: string | null;
    };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[),.!?:;\]}]+$/u;

export function normalizeExternalUrl(value: string): string | null {
  try {
    const parsed = new URL(value.replace(TRAILING_PUNCTUATION, ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractExternalUrls(text: string, limit = 2): string[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4) throw new Error("link preview limit must be 1 through 4");
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = normalizeExternalUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length === limit) break;
  }
  return urls;
}

export function isXPostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "x.com" || host === "twitter.com") && /^\/[^/]+\/status\/\d+(?:\/|$)/u.test(url.pathname);
  } catch {
    return false;
  }
}

export function splitMessageLinks(text: string): Array<{ text: string; url?: string }> {
  const parts: Array<{ text: string; url?: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: text.slice(cursor, index) });
    const raw = match[0];
    const url = normalizeExternalUrl(raw);
    const linkedLength = url ? raw.replace(TRAILING_PUNCTUATION, "").length : 0;
    if (url) parts.push({ text: raw.slice(0, linkedLength), url });
    else parts.push({ text: raw });
    if (linkedLength < raw.length) parts.push({ text: raw.slice(linkedLength) });
    cursor = index + raw.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts.length ? parts : [{ text }];
}
