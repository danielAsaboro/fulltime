"use client";

/* Verified attachment bytes use a short-lived browser object URL. */
/* eslint-disable @next/next/no-img-element */

import {
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Paperclip,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RoomAttachment, RoomFeedItem, RoomMediaDownload, RoomMemberView, RoomUnreadState } from "@/lib/data";
import type { Fixture, RoomMarketReference } from "@fulltime/shared";
import { cn } from "@/lib/cn";
import { PeerAvatar } from "@/components/peer-avatar";
import { PollCard } from "@/components/poll-card";
import { MessageContent } from "@/components/message-content";

const QUICK_REACTIONS = ["🔥", "⚽", "👏", "😮"] as const;
type OptimisticReactions = Record<string, Record<string, boolean>>;

export interface RoomFeedProps {
  items: RoomFeedItem[];
  unreadState: RoomUnreadState;
  typingUsers: RoomMemberView[];
  canParticipate: boolean;
  onRequireSignIn: () => void;
  onReact: (itemId: string, emoji: string) => Promise<void>;
  onRead: (itemId: string) => Promise<void>;
  onReply: (item: RoomFeedItem) => void;
  onVote: (pollId: string, optionId: string) => void;
  onDownloadAttachment: (itemId: string) => Promise<RoomMediaDownload>;
  fixture: Fixture;
  onAttachMarket: (input: RoomMarketReference & { pollId: string }) => Promise<void>;
  hasOlder: boolean;
  loadingOlder: boolean;
  historyError: string | null;
  onLoadOlder: () => Promise<void>;
}

function ordered(items: RoomFeedItem[]): RoomFeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = String(item.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function localTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function RoomFeed({
  items,
  unreadState,
  typingUsers,
  canParticipate,
  onRequireSignIn,
  onReact,
  onRead,
  onReply,
  onVote,
  onDownloadAttachment,
  hasOlder,
  loadingOlder,
  historyError,
  onLoadOlder,
  fixture,
  onAttachMarket,
}: RoomFeedProps) {
  const sortedItems = useMemo(() => ordered(items), [items]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atEdgeRef = useRef(true);
  const previousCountRef = useRef(sortedItems.length);
  const latestIdRef = useRef<string | null>(null);
  const onReadRef = useRef(onRead);
  const [atEdge, setAtEdge] = useState(true);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticReactions>({});

  useEffect(() => {
    latestIdRef.current = sortedItems.at(-1) ? String(sortedItems.at(-1)!.id) : null;
    onReadRef.current = onRead;
  }, [onRead, sortedItems]);

  const jumpToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    atEdgeRef.current = true;
    setAtEdge(true);
    setNewWhileAway(0);
    if (latestIdRef.current) void onReadRef.current(latestIdRef.current).catch(() => undefined);
  }, []);

  useEffect(() => {
    const previous = previousCountRef.current;
    const added = Math.max(0, sortedItems.length - previous);
    previousCountRef.current = sortedItems.length;
    if (atEdgeRef.current) requestAnimationFrame(() => jumpToLatest(previous === 0 ? "auto" : "smooth"));
    else if (added) setNewWhileAway((count) => count + added);
  }, [jumpToLatest, sortedItems.length]);

  useEffect(() => {
    requestAnimationFrame(() => jumpToLatest("auto"));
  }, [jumpToLatest]);

  const react = async (item: RoomFeedItem, emoji: string) => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    const itemId = String(item.id);
    if (item.reactions.some((reaction) => reaction.emoji === emoji && reaction.reactedByMe) || optimistic[itemId]?.[emoji]) return;
    setOptimistic((state) => ({ ...state, [itemId]: { ...state[itemId], [emoji]: true } }));
    try {
      await onReact(itemId, emoji);
    } catch {
      // The authoritative projection will remain unchanged; clear the optimistic chip below.
    } finally {
      setOptimistic((state) => {
        const next = { ...state };
        const itemState = { ...next[itemId] };
        delete itemState[emoji];
        if (Object.keys(itemState).length) next[itemId] = itemState;
        else delete next[itemId];
        return next;
      });
    }
  };

  const loadOlder = async () => {
    const node = scrollerRef.current;
    const previousHeight = node?.scrollHeight ?? 0;
    const previousTop = node?.scrollTop ?? 0;
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (!node) return;
      node.scrollTop = previousTop + node.scrollHeight - previousHeight;
    });
  };

  if (!sortedItems.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="grid size-11 place-items-center rounded-full border border-ash bg-white/50">
          <MessagesSquare className="size-5" aria-hidden />
        </div>
        <h2 className="mt-4 text-subheading">Start the conversation</h2>
        <p className="mt-2 max-w-sm text-body-sm text-smoke">Send the first encrypted message or open a room poll.</p>
      </div>
    );
  }

  const unseen = Math.max(unreadState.count, newWhileAway);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        onScroll={() => {
          const node = scrollerRef.current;
          if (!node) return;
          const next = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
          if (next === atEdgeRef.current) return;
          atEdgeRef.current = next;
          setAtEdge(next);
          if (next) {
            setNewWhileAway(0);
            if (latestIdRef.current) void onReadRef.current(latestIdRef.current).catch(() => undefined);
          }
        }}
        className="absolute inset-0 overflow-y-auto overscroll-contain scroll-smooth"
        aria-label="Room chat"
      >
        <ol className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6">
          {hasOlder ? (
            <li className="pb-4 text-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="inline-flex items-center gap-2 rounded-full border border-ash bg-white/45 px-4 py-2 text-caption text-smoke hover:text-off-black disabled:opacity-50"
              >
                {loadingOlder ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
                {loadingOlder ? "Loading history" : "Load older messages"}
              </button>
            </li>
          ) : null}
          {historyError ? <li className="pb-3 text-center text-caption text-crimson">{historyError}</li> : null}
          {sortedItems.map((item) => (
            <li key={String(item.id)}>
              {unreadState.count > 0 && unreadState.firstUnreadItemId === item.id ? (
                <UnreadDivider count={unreadState.count} />
              ) : null}
              <FeedItem
                item={item}
                optimistic={optimistic[String(item.id)]}
                canParticipate={canParticipate}
                onRequireSignIn={onRequireSignIn}
                onReact={(emoji) => void react(item, emoji)}
                onReply={() => onReply(item)}
                onVote={onVote}
                onDownloadAttachment={onDownloadAttachment}
                fixture={fixture}
                onAttachMarket={onAttachMarket}
              />
            </li>
          ))}
        </ol>
        <TypingPresence users={typingUsers} />
      </div>

      {!atEdge ? (
        <button
          type="button"
          onClick={() => jumpToLatest()}
          className="absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-off-black px-4 py-2 text-caption uppercase tracking-[0.06em] text-parchment shadow-lg"
        >
          <ChevronDown className="size-3.5" aria-hidden />
          Latest {unseen ? <span className="rounded-full bg-coral px-1.5 py-0.5 text-off-black">{unseen}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

function FeedItem({
  item,
  optimistic,
  canParticipate,
  onRequireSignIn,
  onReact,
  onReply,
  onVote,
  onDownloadAttachment,
  fixture,
  onAttachMarket,
}: {
  item: RoomFeedItem;
  optimistic?: Record<string, boolean>;
  canParticipate: boolean;
  onRequireSignIn: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onVote: (pollId: string, optionId: string) => void;
  onDownloadAttachment: (itemId: string) => Promise<RoomMediaDownload>;
  fixture: Fixture;
  onAttachMarket: (input: RoomMarketReference & { pollId: string }) => Promise<void>;
}) {
  if (item.kind === "system") {
    return (
      <article id={String(item.id)} className="py-4 text-center">
        <div className="mx-auto inline-flex max-w-[90%] items-center gap-2 bg-periwinkle-mist/40 px-3 py-1.5 text-caption">
          <Sparkles className="size-3.5" aria-hidden />
          <span>{item.text}</span>
          <span className="text-smoke">· {localTime(Number(item.createdAt))}</span>
        </div>
        <ReplyAction count={item.replyCount} onClick={onReply} className="mx-auto mt-2" />
      </article>
    );
  }

  return (
    <article id={String(item.id)} className={cn("group flex gap-3 py-4", item.author?.isCurrentUser && "flex-row-reverse")}>
      <PeerAvatar
        userId={item.author?.userId}
        displayName={item.author?.displayName ?? "Room"}
        size="md"
        isCurrentUser={Boolean(item.author?.isCurrentUser)}
      />
      <div className={cn("min-w-0 flex-1", item.author?.isCurrentUser && "flex flex-col items-end")}>
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-caption text-smoke">
          <span className="font-medium text-off-black">{item.author?.displayName ?? "Room"}</span>
          {item.author?.role === "creator" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-off-black px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-parchment">
              <ShieldCheck className="size-3" aria-hidden /> host
            </span>
          ) : item.author?.role === "moderator" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-periwinkle-mist px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-off-black">
              <ShieldCheck className="size-3" aria-hidden /> mod
            </span>
          ) : null}
          <time dateTime={new Date(Number(item.createdAt)).toISOString()}>{localTime(Number(item.createdAt))}</time>
        </div>
        <div className={cn("w-full max-w-[92%] sm:max-w-[86%]", item.author?.isCurrentUser && "ml-auto")}>
          {item.kind === "text" ? (
            <div className={cn("rounded-[18px] bg-white/65 px-4 py-3", item.author?.isCurrentUser && "bg-periwinkle-mist/65")}>
              {item.quote ? (
                <a
                  href={`#${String(item.quote.itemId)}`}
                  className="mb-2 block border-l-2 border-off-black/35 bg-parchment/65 px-3 py-2 text-body-sm text-smoke transition hover:border-off-black/70"
                >
                  <span className="block text-caption font-semibold text-off-black">{item.quote.author.displayName}</span>
                  <span className="line-clamp-2">{item.quote.text}</span>
                </a>
              ) : null}
              {item.text ? <MessageContent text={item.text} /> : null}
              {item.attachment ? <AttachmentView itemId={String(item.id)} attachment={item.attachment} onDownload={onDownloadAttachment} /> : null}
            </div>
          ) : (
            <PollCard
              key={`${item.id}:${item.myVote ?? "none"}`}
              poll={item.poll}
              myVote={item.myVote}
              canVote={canParticipate}
              onVote={(option) => {
                if (!canParticipate) onRequireSignIn();
                else onVote(String(item.poll.id), option);
              }}
              className="rounded-[18px] bg-white/45 p-4 sm:p-5"
              fixture={fixture}
              isAuthor={Boolean(item.author?.isCurrentUser)}
              onAttachMarket={onAttachMarket}
            />
          )}
          <ItemActions
            item={item}
            optimistic={optimistic}
            canReact={item.kind === "text"}
            canParticipate={canParticipate}
            onReact={onReact}
            onReply={onReply}
          />
        </div>
      </div>
    </article>
  );
}

function AttachmentView({
  itemId,
  attachment,
  onDownload,
}: {
  itemId: string;
  attachment: RoomAttachment;
  onDownload: (itemId: string) => Promise<RoomMediaDownload>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const isImage = attachment.mimeType.startsWith("image/");

  useEffect(() => () => {
    aliveRef.current = false;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const load = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const downloaded = await onDownload(itemId);
      if (downloaded.name !== attachment.name || downloaded.mimeType !== attachment.mimeType) {
        downloaded.bytes.fill(0);
        throw new Error("Verified attachment metadata changed while downloading.");
      }
      const blobBytes = new Uint8Array(downloaded.bytes.byteLength);
      blobBytes.set(downloaded.bytes);
      const blob = new Blob([blobBytes.buffer], { type: downloaded.mimeType });
      downloaded.bytes.fill(0);
      blobBytes.fill(0);
      if (!isImage) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return;
      }
      const url = URL.createObjectURL(blob);
      if (!aliveRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setImageUrl(url);
    } catch (reason) {
      if (aliveRef.current) setError(reason instanceof Error ? reason.message : "Attachment could not be verified.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  return (
    <div className={cn(itemId && "mt-2", "overflow-hidden rounded-xl border border-ash/80 bg-parchment/55")}>
      {isImage && imageUrl ? <img src={imageUrl} alt={attachment.name} className="max-h-[460px] w-full object-contain" /> : null}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-caption">
        <span className="min-w-0 truncate"><Paperclip className="mr-1 inline size-3.5 text-smoke" aria-hidden />{attachment.name} · {formatBytes(attachment.sizeBytes)}</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="shrink-0 font-medium text-lake-blue disabled:opacity-50">
          {loading ? "Verifying…" : isImage ? imageUrl ? "Reload" : "Load image" : "Download"}
        </button>
      </div>
      {error ? <p className="border-t border-ash/70 px-3 py-2 text-[11px] text-crimson">{error}</p> : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function ItemActions({
  item,
  optimistic,
  canReact,
  canParticipate,
  onReact,
  onReply,
}: {
  item: RoomFeedItem;
  optimistic?: Record<string, boolean>;
  canReact: boolean;
  canParticipate: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const reactions = useMemo(() => {
    const map = new Map(item.reactions.map((reaction) => [reaction.emoji, reaction]));
    for (const [emoji, pending] of Object.entries(optimistic ?? {})) {
      if (!pending) continue;
      const current = map.get(emoji) ?? { emoji, count: 0, reactedByMe: false };
      map.set(emoji, { ...current, count: current.count + (current.reactedByMe ? 0 : 1), reactedByMe: true });
    }
    return [...map.values()].filter((reaction) => reaction.count > 0);
  }, [item.reactions, optimistic]);

  return (
    <div className={cn("relative mt-1.5 flex flex-wrap items-center gap-1", item.author?.isCurrentUser && "justify-end")}>
      {canReact ? reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => onReact(reaction.emoji)}
          disabled={!canParticipate || reaction.reactedByMe}
          className={cn("inline-flex min-h-10 items-center gap-1 rounded-full border px-2.5 text-caption focus-visible:ring-2 focus-visible:ring-lake-blue", reaction.reactedByMe ? "border-lake-blue bg-periwinkle-mist/55" : "border-ash")}
        >
          {reaction.emoji} {reaction.count}
        </button>
      )) : null}
      {canReact ? (
        <button type="button" onClick={() => setOpen((value) => !value)} className="grid size-10 place-items-center rounded-full text-smoke hover:bg-white focus-visible:ring-2 focus-visible:ring-lake-blue" aria-label="React">☺</button>
      ) : null}
      <ReplyAction count={item.replyCount} onClick={onReply} />
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(new URL(item.permalink, window.location.origin).toString()).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        })}
        className="inline-flex min-h-10 items-center gap-1 rounded-full px-2.5 text-caption text-smoke hover:bg-white hover:text-off-black focus-visible:ring-2 focus-visible:ring-lake-blue"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Copied" : "Copy link"}
      </button>
      {open && canReact ? (
        <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-full border border-ash bg-parchment p-1.5 shadow-lg">
          {QUICK_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => { onReact(emoji); setOpen(false); }} className="grid size-10 place-items-center rounded-full hover:bg-white focus-visible:ring-2 focus-visible:ring-lake-blue">{emoji}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReplyAction({ count, onClick, className }: { count: number; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex min-h-10 items-center gap-1 rounded-full px-2.5 text-caption text-smoke hover:bg-white hover:text-off-black focus-visible:ring-2 focus-visible:ring-lake-blue", className)}>
      <MessageCircle className="size-3.5" />{count ? `${count} ${count === 1 ? "reply" : "replies"}` : "Reply"}
    </button>
  );
}

function UnreadDivider({ count }: { count: number }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-lake-blue/40" />
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-lake-blue">{count} new</span>
      <span className="h-px flex-1 bg-lake-blue/40" />
    </div>
  );
}

function TypingPresence({ users }: { users: RoomMemberView[] }) {
  if (!users.length) return <div className="h-4" />;
  const names = users.slice(0, 2).map((user) => user.displayName);
  const label = users.length > 2 ? `${names.join(", ")} and ${users.length - 2} more` : names.join(" and ");
  return <p className="px-6 pb-4 text-caption text-smoke">{label} {users.length === 1 ? "is" : "are"} typing…</p>;
}

export function FeedKindIcon({ kind }: { kind: RoomFeedItem["kind"] }) {
  if (kind === "poll") return <span aria-hidden>◎</span>;
  if (kind === "system") return <Sparkles className="size-3.5" aria-hidden />;
  return <MessageCircle className="size-3.5" aria-hidden />;
}
