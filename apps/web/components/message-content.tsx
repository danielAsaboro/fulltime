"use client";

/* Preview images are arbitrary remote OpenGraph URLs and cannot use a finite Next Image allowlist. */
/* eslint-disable @next/next/no-img-element */

import { ExternalLink, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { extractExternalUrls, splitMessageLinks, type LinkPreview } from "@/lib/link-preview";

declare global {
  interface Window { twttr?: { widgets?: { load(element?: HTMLElement): void } } }
}

let xWidgetsPromise: Promise<void> | null = null;

function loadXWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve();
  if (xWidgetsPromise) return xWidgetsPromise;
  xWidgetsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://platform.twitter.com/widgets.js"]');
    const script = existing ?? document.createElement("script");
    const finish = () => resolve();
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("X embed script could not load")), { once: true });
    if (!existing) { script.src = "https://platform.twitter.com/widgets.js"; script.async = true; script.charset = "utf-8"; document.head.appendChild(script); }
  });
  return xWidgetsPromise;
}

export function MessageContent({ text }: { text: string }) {
  const urls = extractExternalUrls(text);
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-body text-off-black">
        {splitMessageLinks(text).map((part, index) => part.url ? (
          <a key={`${part.url}:${index}`} href={part.url} target="_blank" rel="noreferrer" className="font-medium text-lake-blue underline decoration-lake-blue/35 underline-offset-2 hover:decoration-lake-blue focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-lake-blue">
            {part.text}<ExternalLink className="ml-1 inline size-3.5" aria-hidden />
          </a>
        ) : <span key={index}>{part.text}</span>)}
      </p>
      {urls.length ? <div className="mt-3 space-y-2">{urls.map((url) => <LinkPreviewCard key={url} url={url} />)}</div> : null}
    </>
  );
}

function LinkPreviewCard({ url }: { url: string }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: string } | { status: "ready"; preview: LinkPreview }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as LinkPreview | { error?: string } | null;
        if (!response.ok) throw new Error(payload && "error" in payload ? payload.error : `Preview failed with HTTP ${response.status}`);
        setState({ status: "ready", preview: payload as LinkPreview });
      })
      .catch((cause) => { if (!controller.signal.aborted) setState({ status: "error", error: cause instanceof Error ? cause.message : "Preview unavailable" }); });
    return () => controller.abort();
  }, [revision, url]);

  if (state.status === "loading") return <div className="flex min-h-20 items-center gap-3 rounded-xl border border-ash bg-parchment/70 px-4 text-caption text-smoke" aria-busy="true"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Loading preview…</div>;
  if (state.status === "error") return <div className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-ash bg-parchment/70 px-4 py-3"><a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-caption font-medium text-lake-blue">Open link</a><button type="button" onClick={() => { setState({ status: "loading" }); setRevision((value) => value + 1); }} className="grid size-10 shrink-0 place-items-center rounded-full text-smoke hover:bg-white focus-visible:ring-2 focus-visible:ring-lake-blue" aria-label={`Retry preview: ${state.error}`} title={state.error}><RotateCcw className="size-4" aria-hidden /></button></div>;
  return state.preview.kind === "x" ? <XPostEmbed preview={state.preview} /> : (
    <a href={state.preview.url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl border border-ash bg-parchment/80 focus-visible:ring-2 focus-visible:ring-lake-blue">
      {state.preview.imageUrl ? <img src={state.preview.imageUrl} alt="" width={640} height={320} loading="lazy" className="max-h-48 w-full bg-ash/30 object-cover" /> : null}
      <span className="block p-3"><span className="block text-[10px] uppercase tracking-[0.08em] text-smoke">{state.preview.siteName}</span><strong className="mt-1 block line-clamp-2 text-body-sm text-off-black group-hover:text-lake-blue">{state.preview.title}</strong>{state.preview.description ? <span className="mt-1 block line-clamp-2 text-caption text-smoke">{state.preview.description}</span> : null}</span>
    </a>
  );
}

function XPostEmbed({ preview }: { preview: Extract<LinkPreview, { kind: "x" }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void loadXWidgets().then(() => { if (alive && ref.current) window.twttr?.widgets?.load(ref.current); }).catch(() => undefined);
    return () => { alive = false; };
  }, [preview.html]);
  return <div ref={ref} className="overflow-hidden rounded-xl border border-ash bg-white px-3 [&_.twitter-tweet]:mx-auto! [&_.twitter-tweet]:my-2!" aria-label={`X post by ${preview.authorName}`} dangerouslySetInnerHTML={{ __html: preview.html }} />;
}
