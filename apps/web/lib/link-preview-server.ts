import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isXPostUrl, normalizeExternalUrl, type LinkPreview } from "@/lib/link-preview";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127) || a >= 224;
  }
  const normalized = address.toLowerCase().split("%")[0]!;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function assertPublicUrl(value: string): Promise<URL> {
  const normalized = normalizeExternalUrl(value);
  if (!normalized) throw new Error("Preview URL must use HTTP or HTTPS");
  const url = new URL(normalized);
  if (url.username || url.password || url.port && !["80", "443"].includes(url.port)) throw new Error("Preview URL contains unsupported authority details");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) throw new Error("Local addresses cannot be previewed");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("Private network addresses cannot be previewed");
  return url;
}

async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Preview response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Preview response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function fetchPublicHtml(value: string, redirects = 0): Promise<{ url: URL; html: string }> {
  const url = await assertPublicUrl(value);
  const response = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "FullTime-LinkPreview/1.0 (+https://usefulltime.xyz)" },
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Preview redirected too many times");
    const location = response.headers.get("location");
    if (!location) throw new Error("Preview redirect is missing a destination");
    return fetchPublicHtml(new URL(location, url).toString(), redirects + 1);
  }
  if (!response.ok) throw new Error(`Preview source returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("Preview source is not an HTML page");
  return { url, html: await limitedText(response) };
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|#39|lt|gt|nbsp);/gu, (entity) => ({ "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " }[entity] ?? entity));
}

function meta(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "iu"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "iu"),
    ];
    for (const pattern of patterns) {
      const value = html.match(pattern)?.[1]?.trim();
      if (value) return decodeHtml(value).replace(/\s+/gu, " ").slice(0, 500);
    }
  }
  return null;
}

function title(html: string): string | null {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]?.replace(/<[^>]+>/gu, "").trim();
  return value ? decodeHtml(value).replace(/\s+/gu, " ").slice(0, 200) : null;
}

async function xPreview(url: string): Promise<LinkPreview> {
  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("dnt", "true");
  endpoint.searchParams.set("hide_thread", "false");
  endpoint.searchParams.set("omit_script", "true");
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null) as { html?: unknown; author_name?: unknown; author_url?: unknown; title?: unknown; url?: unknown } | null;
  if (!response.ok || typeof payload?.html !== "string" || typeof payload.author_name !== "string" || typeof payload.author_url !== "string") {
    throw new Error(`X embed is unavailable${response.ok ? "" : ` (HTTP ${response.status})`}`);
  }
  const paragraph = payload.html.match(/<p[^>]*>([\s\S]*?)<\/p>/iu)?.[1]
    ?.replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .trim();
  const text = paragraph ? decodeHtml(paragraph).replace(/[ \t]+/gu, " ").slice(0, 1_000) : `Post by ${payload.author_name}`;
  return { kind: "x", url, title: typeof payload.title === "string" && payload.title ? payload.title : `Post by ${payload.author_name}`, authorName: payload.author_name, authorUrl: payload.author_url, text, html: payload.html };
}

export async function loadLinkPreview(value: string): Promise<LinkPreview> {
  const normalized = normalizeExternalUrl(value);
  if (!normalized) throw new Error("Preview URL is invalid");
  if (isXPostUrl(normalized)) return xPreview(normalized);
  const page = await fetchPublicHtml(normalized);
  const pageTitle = meta(page.html, ["og:title", "twitter:title"]) ?? title(page.html) ?? page.url.hostname.replace(/^www\./, "");
  const description = meta(page.html, ["og:description", "twitter:description", "description"]);
  const image = meta(page.html, ["og:image:secure_url", "og:image", "twitter:image"]);
  let imageUrl: string | null = null;
  if (image) {
    try {
      const candidate = new URL(image, page.url);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") imageUrl = candidate.toString();
    } catch { /* Broken metadata does not invalidate the page preview. */ }
  }
  return { kind: "link", url: page.url.toString(), title: pageTitle, description, siteName: meta(page.html, ["og:site_name"]) ?? page.url.hostname.replace(/^www\./, ""), imageUrl };
}
