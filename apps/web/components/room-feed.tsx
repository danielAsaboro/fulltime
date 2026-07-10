"use client";

/* User-selected browser previews can be blob URLs, so next/image is not a fit here. */
/* eslint-disable @next/next/no-img-element */

import {
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  ImageIcon,
  Link2,
  MessageCircle,
  ReceiptText,
  Share2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RoomFeedItem, RoomMemberView, RoomUnreadState } from "@/lib/data";
import { cn } from "@/lib/cn";
import { CallCard } from "@/components/call-card";
import { MarketSaysCard } from "@/components/market-says-card";
import { PollCard } from "@/components/poll-card";
import { ReceiptChip } from "@/components/receipt-chip";

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
  onAnswer: (callId: string, optionId: string) => void;
  onOpenImage: (url: string, alt: string) => void;
}

function ordered(items: RoomFeedItem[]): RoomFeedItem[] {
  return [...items].sort((a, b) => {
    const byTime = Number(a.releaseAt) - Number(b.releaseAt);
    return byTime || String(a.id).localeCompare(String(b.id));
  });
}

function localTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function itemTime(item: RoomFeedItem): string {
  return item.matchMinute != null ? `${item.matchMinute}'` : localTime(Number(item.createdAt));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
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
  onAnswer,
  onOpenImage,
}: RoomFeedProps) {
  // Receipts live in their persistent room tool, not in the conversation.
  // Keep this guard so an adapter cannot accidentally duplicate them here.
  const sortedItems = useMemo(() => ordered(items.filter((item) => item.kind !== "receipt")), [items]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atLiveEdgeRef = useRef(true);
  const previousCountRef = useRef(sortedItems.length);
  const latestItemIdRef = useRef<string | null>(null);
  const onReadRef = useRef(onRead);
  const [atLiveEdge, setAtLiveEdge] = useState(true);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const [optimistic, setOptimistic] = useState<OptimisticReactions>({});

  useEffect(() => {
    latestItemIdRef.current = sortedItems.length ? String(sortedItems[sortedItems.length - 1]!.id) : null;
    onReadRef.current = onRead;
  }, [onRead, sortedItems]);

  const jumpToLive = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    atLiveEdgeRef.current = true;
    setAtLiveEdge(true);
    setNewWhileAway(0);
    const latestItemId = latestItemIdRef.current;
    if (latestItemId) void onReadRef.current(latestItemId).catch(() => undefined);
  }, []);

  useEffect(() => {
    const previous = previousCountRef.current;
    const delta = Math.max(0, sortedItems.length - previous);
    previousCountRef.current = sortedItems.length;
    if (atLiveEdgeRef.current) {
      requestAnimationFrame(() => jumpToLive(previous === 0 ? "auto" : "smooth"));
    } else if (delta > 0) {
      setNewWhileAway((count) => count + delta);
    }
  }, [jumpToLive, sortedItems.length]);

  useEffect(() => {
    requestAnimationFrame(() => {
      const requested = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("item");
      const target = requested ? document.getElementById(requested) : null;
      if (target) {
        target.scrollIntoView({ block: "center" });
        atLiveEdgeRef.current = false;
        setAtLiveEdge(false);
      } else {
        jumpToLive("auto");
      }
    });
  }, [jumpToLive]);

  useEffect(() => {
    const preserveLiveEdge = () => {
      const wasAtLiveEdge = atLiveEdgeRef.current;
      if (wasAtLiveEdge) requestAnimationFrame(() => jumpToLive("auto"));
    };
    window.addEventListener("resize", preserveLiveEdge);
    return () => window.removeEventListener("resize", preserveLiveEdge);
  }, [jumpToLive]);

  const handleScroll = () => {
    const node = scrollerRef.current;
    if (!node) return;
    const next = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
    if (next !== atLiveEdgeRef.current) {
      atLiveEdgeRef.current = next;
      setAtLiveEdge(next);
      if (next) setNewWhileAway(0);
      const latestItemId = latestItemIdRef.current;
      if (next && latestItemId) void onReadRef.current(latestItemId).catch(() => undefined);
    }
  };

  const handleReaction = async (item: RoomFeedItem, emoji: string) => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    const current = item.reactions.find((reaction) => reaction.emoji === emoji)?.reactedByMe ?? false;
    const pending = optimistic[String(item.id)]?.[emoji];
    // The adapter intentionally deduplicates reactions per account; it is add-only.
    if (current || pending) return;
    const desired = true;
    setOptimistic((state) => ({
      ...state,
      [String(item.id)]: { ...state[String(item.id)], [emoji]: desired },
    }));
    try {
      await onReact(String(item.id), emoji);
      setOptimistic((state) => {
        const next = { ...state };
        const reactions = { ...next[String(item.id)] };
        delete reactions[emoji];
        if (Object.keys(reactions).length) next[String(item.id)] = reactions;
        else delete next[String(item.id)];
        return next;
      });
    } catch {
      setOptimistic((state) => {
        const next = { ...state };
        const reactions = { ...next[String(item.id)] };
        delete reactions[emoji];
        if (Object.keys(reactions).length) next[String(item.id)] = reactions;
        else delete next[String(item.id)];
        return next;
      });
    }
  };

  if (sortedItems.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="grid size-11 place-items-center rounded-full border border-ash bg-white/50">
          <MessageCircle className="size-5" aria-hidden />
        </div>
        <h2 className="mt-4 text-subheading">Start the room chat</h2>
        <p className="mt-2 max-w-sm text-body-sm text-smoke">
          Messages, match moments, calls and polls will share this live timeline.
        </p>
      </div>
    );
  }

  const unseen = Math.max(unreadState.count, newWhileAway);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto overscroll-contain scroll-smooth [overflow-anchor:auto]"
        aria-label="Room chat"
      >
        <ol className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6">
          {sortedItems.map((item, index) => {
            const previous = sortedItems[index - 1];
            const followsChat = Boolean(previous
              && (previous.kind === "text" || previous.kind === "image")
              && (item.kind === "text" || item.kind === "image"));
            return (
              <li
                key={String(item.id)}
                className={cn(index > 0 && !followsChat && "border-t border-ash/70")}
              >
                {unreadState.count > 0 && unreadState.firstUnreadItemId === item.id ? (
                  <UnreadDivider count={unreadState.count} />
                ) : null}
                <FeedItem
                  item={item}
                  optimistic={optimistic[String(item.id)]}
                  canParticipate={canParticipate}
                  onReact={(emoji) => handleReaction(item, emoji)}
                  onReply={() => onReply(item)}
                  onVote={onVote}
                  onAnswer={onAnswer}
                  onOpenImage={onOpenImage}
                />
              </li>
            );
          })}
        </ol>
        <TypingPresence users={typingUsers} />
        <div className="h-3" aria-hidden />
      </div>

      {!atLiveEdge ? (
        <button
          type="button"
          onClick={() => jumpToLive()}
          className="absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-off-black bg-off-black px-4 py-2 text-caption uppercase tracking-[0.06em] text-parchment shadow-lg"
        >
          <ChevronDown className="size-3.5" aria-hidden />
          Jump to live {unseen > 0 ? <span className="rounded-full bg-coral px-1.5 py-0.5 text-off-black">{unseen}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

function UnreadDivider({ count }: { count: number }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator" aria-label={`${count} unread messages`}>
      <span className="h-px flex-1 bg-lake-blue/40" />
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-lake-blue">
        {count} new {count === 1 ? "item" : "items"}
      </span>
      <span className="h-px flex-1 bg-lake-blue/40" />
    </div>
  );
}

function FeedItem({
  item,
  optimistic,
  canParticipate,
  onReact,
  onReply,
  onVote,
  onAnswer,
  onOpenImage,
}: {
  item: RoomFeedItem;
  optimistic?: Record<string, boolean>;
  canParticipate: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onVote: (pollId: string, optionId: string) => void;
  onAnswer: (callId: string, optionId: string) => void;
  onOpenImage: (url: string, alt: string) => void;
}) {
  if (item.kind === "system") {
    return <SystemItem item={item} onReply={onReply} onReact={onReact} optimistic={optimistic} reactionsDisabled={!canParticipate} />;
  }

  const authored = Boolean(item.author);
  const reactionsHidden = item.kind !== "text" && item.kind !== "image" && item.kind !== "event";
  return (
    <article
      id={String(item.id)}
      className={cn(
        "group relative flex gap-3 py-4 [overflow-anchor:none]",
        item.author?.isCurrentUser && "flex-row-reverse",
      )}
    >
      <Avatar name={item.author?.displayName ?? kindLabel(item)} current={item.author?.isCurrentUser} />
      <div className={cn("min-w-0 flex-1", item.author?.isCurrentUser && authored && "flex flex-col items-end")}>
        <div className={cn("mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1", item.author?.isCurrentUser && "justify-end")}>
          <span className="text-body-sm font-medium text-off-black">{item.author?.displayName ?? kindLabel(item)}</span>
          {item.author?.role === "creator" || item.author?.role === "moderator" ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-smoke">
              <ShieldCheck className="size-3" aria-hidden />
              {item.author.role}
            </span>
          ) : null}
          <time className="text-caption text-smoke" dateTime={new Date(Number(item.createdAt)).toISOString()}>
            {itemTime(item)}
          </time>
          {item.editedAt ? <span className="text-caption text-smoke">edited</span> : null}
        </div>

        <div className={cn("w-full", authored && "max-w-[92%] sm:max-w-[86%]", item.author?.isCurrentUser && "ml-auto")}>
          <ItemBody
            item={item}
            canParticipate={canParticipate}
            onVote={onVote}
            onAnswer={onAnswer}
            onOpenImage={onOpenImage}
          />
          <ItemActions
            item={item}
            optimistic={optimistic}
            onReact={onReact}
            onReply={onReply}
            reactionsDisabled={!canParticipate}
            reactionsHidden={reactionsHidden}
          />
          {item.replies.length > 0 ? <ReplyPreview item={item} onOpen={onReply} /> : null}
        </div>
      </div>
    </article>
  );
}

function ItemBody({
  item,
  canParticipate,
  onVote,
  onAnswer,
  onOpenImage,
}: {
  item: RoomFeedItem;
  canParticipate: boolean;
  onVote: (pollId: string, optionId: string) => void;
  onAnswer: (callId: string, optionId: string) => void;
  onOpenImage: (url: string, alt: string) => void;
}) {
  switch (item.kind) {
    case "text":
      return (
        <div className={cn("rounded-[18px] bg-white/65 px-4 py-3", item.author?.isCurrentUser && "bg-periwinkle-mist/65")}>
          <p className="whitespace-pre-wrap break-words text-body text-off-black">{item.text}</p>
        </div>
      );
    case "image":
      return (
        <div className={cn("overflow-hidden rounded-[18px] bg-white/65", item.author?.isCurrentUser && "bg-periwinkle-mist/65")}>
          <AttachmentView attachment={item.attachment} onOpen={onOpenImage} />
          {item.caption ? <p className="whitespace-pre-wrap break-words px-4 py-3 text-body">{item.caption}</p> : null}
        </div>
      );
    case "event":
      return (
        <div className="border-l-2 border-coral bg-coral/10 px-4 py-3">
          <p className="text-label font-medium uppercase tracking-[-0.02em]">{item.label}</p>
          {item.event.detail ? <p className="mt-1 text-body-sm text-graphite">{item.event.detail}</p> : null}
          {item.event.score ? (
            <p className="mt-2 text-caption uppercase tracking-[0.08em] text-smoke">
              Score {item.event.score.home}–{item.event.score.away}
            </p>
          ) : null}
        </div>
      );
    case "poll":
      return (
        <PollCard
          key={`${item.id}:${item.myVote ?? "none"}`}
          poll={item.poll}
          myVote={item.myVote}
          canVote={canParticipate}
          onVote={(option) => onVote(String(item.poll.id), option)}
          className="rounded-[18px] bg-white/45 p-4 sm:p-5"
        />
      );
    case "call":
      return (
        <CallCard
          view={item.call}
          canSelect={canParticipate}
          showReceipt={false}
          onSelect={(option) => onAnswer(String(item.call.call.id), option)}
          className="rounded-[18px] bg-white/45 p-4 sm:p-5"
        />
      );
    case "odds":
      return <MarketSaysCard card={item.marketSays} className="rounded-[18px] bg-gold/20 p-4 sm:p-5" />;
    case "receipt":
      return (
        <div className="border border-ash bg-white/45 px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-caption uppercase tracking-[0.1em] text-smoke">Verified receipt</p>
              <p className="mt-1 text-body-sm text-off-black">{item.receipt.headline}</p>
            </div>
            <ReceiptChip state={item.receipt.receipt.state} receiptId={String(item.receipt.receipt.id)} />
          </div>
        </div>
      );
  }
}

function AttachmentView({
  attachment,
  onOpen,
}: {
  attachment: Extract<RoomFeedItem, { kind: "image" }>["attachment"];
  onOpen: (url: string, alt: string) => void;
}) {
  if (attachment.status === "failed") {
    return (
      <div className="grid min-h-40 place-items-center bg-coral/10 px-6 text-center text-body-sm text-graphite">
        {attachment.error ?? "Image upload failed"}
      </div>
    );
  }
  if (attachment.status === "cancelled") {
    return <div className="grid min-h-32 place-items-center bg-ash/20 text-body-sm text-smoke">Upload cancelled</div>;
  }
  return (
    <button
      type="button"
      onClick={() => attachment.status === "ready" && onOpen(attachment.url, attachment.name)}
      className="relative block w-full overflow-hidden bg-off-black/5 text-left"
      aria-label={attachment.status === "ready" ? `Open ${attachment.name}` : `${attachment.name} uploading`}
    >
      <img src={attachment.url} alt={attachment.name} className="max-h-[420px] w-full object-cover" />
      {attachment.status === "uploading" ? (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-off-black/20">
          <span className="block h-full bg-lake-blue" style={{ width: `${attachment.progress}%` }} />
        </span>
      ) : null}
    </button>
  );
}

function SystemItem({
  item,
  optimistic,
  onReact,
  onReply,
  reactionsDisabled,
}: {
  item: Extract<RoomFeedItem, { kind: "system" }>;
  optimistic?: Record<string, boolean>;
  onReact: (emoji: string) => void;
  onReply: () => void;
  reactionsDisabled: boolean;
}) {
  return (
    <article id={String(item.id)} className="group py-4 text-center [overflow-anchor:none]">
      <div
        className={cn(
          "mx-auto inline-flex max-w-[90%] items-center gap-2 px-3 py-1.5 text-caption",
          item.tone === "warning" && "bg-gold/35",
          item.tone === "success" && "bg-mint/35",
          item.tone === "info" && "bg-periwinkle-mist/35",
        )}
      >
        <Sparkles className="size-3.5 shrink-0" aria-hidden />
        <span>{item.text}</span>
        <span className="text-smoke">· {itemTime(item)}</span>
      </div>
      <div className="mx-auto max-w-sm">
        <ItemActions
          item={item}
          optimistic={optimistic}
          onReact={onReact}
          onReply={onReply}
          reactionsDisabled={reactionsDisabled}
          reactionsHidden
          compact
        />
      </div>
    </article>
  );
}

function ItemActions({
  item,
  optimistic,
  onReact,
  onReply,
  reactionsDisabled = false,
  reactionsHidden = false,
  compact = false,
}: {
  item: RoomFeedItem;
  optimistic?: Record<string, boolean>;
  onReact: (emoji: string) => void;
  onReply: () => void;
  reactionsDisabled?: boolean;
  reactionsHidden?: boolean;
  compact?: boolean;
}) {
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [reported, setReported] = useState(false);

  const reactions = useMemo(() => {
    const map = new Map(item.reactions.map((reaction) => [reaction.emoji, reaction]));
    for (const [emoji, desired] of Object.entries(optimistic ?? {})) {
      const fromServer = map.get(emoji) ?? { emoji, count: 0, reactedByMe: false };
      map.set(emoji, {
        ...fromServer,
        reactedByMe: desired,
        count: Math.max(0, fromServer.count + (fromServer.reactedByMe === desired ? 0 : desired ? 1 : -1)),
      });
    }
    return [...map.values()].filter((reaction) => reaction.count > 0);
  }, [item.reactions, optimistic]);

  const absoluteLink = () => {
    if (typeof window === "undefined") return item.permalink;
    return new URL(item.permalink, window.location.origin).toString();
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absoluteLink());
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 1_500);
  };
  const share = async () => {
    const url = absoluteLink();
    try {
      if (navigator.share) await navigator.share({ title: "FullTime room moment", url });
      else await navigator.clipboard.writeText(url);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setCopyState("error");
    }
  };

  return (
    <div className={cn("relative mt-2 flex flex-wrap items-center gap-1.5", compact && "justify-center opacity-70")}>
      {!reactionsHidden ? reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => onReact(reaction.emoji)}
          disabled={reactionsDisabled}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-caption tabular transition-colors",
            reaction.reactedByMe ? "border-lake-blue bg-periwinkle-mist/55 text-lake-blue" : "border-ash bg-white/30 text-graphite",
            reactionsDisabled && "opacity-45",
          )}
          aria-pressed={reaction.reactedByMe}
        >
          <span aria-hidden>{reaction.emoji}</span>
          {reaction.count}
        </button>
      )) : null}
      {!reactionsHidden ? (
        <button
          type="button"
          onClick={() => setReactionsOpen((open) => !open)}
          disabled={reactionsDisabled}
          className="grid size-7 place-items-center rounded-full text-smoke hover:bg-white/70 hover:text-off-black"
          aria-label="React"
          aria-expanded={reactionsOpen}
        >
          <span aria-hidden>☺</span>
        </button>
      ) : null}
      <ActionButton label={item.replyCount ? `${item.replyCount} replies` : "Reply"} onClick={onReply}>
        <MessageCircle className="size-3.5" />
      </ActionButton>
      <ActionButton label={copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy link"} onClick={() => void copyLink()}>
        {copyState === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </ActionButton>
      <ActionButton label="Share" onClick={() => void share()}>
        <Share2 className="size-3.5" />
      </ActionButton>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="grid size-7 place-items-center rounded-full text-smoke hover:bg-white/70 hover:text-off-black"
        aria-label="More actions"
        aria-expanded={menuOpen}
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>

      {reactionsOpen && !reactionsHidden ? (
        <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-1 rounded-full border border-ash bg-parchment p-1.5 shadow-lg">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onReact(emoji);
                setReactionsOpen(false);
              }}
              className="grid size-8 place-items-center rounded-full text-lg hover:bg-periwinkle-mist/60"
              aria-label={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      {menuOpen ? (
        <div className="absolute bottom-full right-0 z-20 mb-1 min-w-40 border border-ash bg-parchment p-1 shadow-lg">
          <button type="button" onClick={() => window.location.assign(absoluteLink())} className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption hover:bg-white/70">
            <Link2 className="size-3.5" /> Open permalink
          </button>
          <button type="button" onClick={() => { setReported(true); setMenuOpen(false); }} className="w-full px-3 py-2 text-left text-caption text-smoke hover:bg-white/70">
            {reported ? "Reported · thank you" : "Report item"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-[11px] text-smoke hover:bg-white/70 hover:text-off-black"
      aria-label={label}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ReplyPreview({ item, onOpen }: { item: RoomFeedItem; onOpen: () => void }) {
  const replies = [...item.replies]
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || String(a.id).localeCompare(String(b.id)))
    .slice(-2);
  return (
    <button type="button" onClick={onOpen} className="mt-2 w-full border-l border-ash pl-3 text-left">
      {replies.map((reply) => (
        <span key={String(reply.id)} className="block truncate text-caption text-graphite">
          <strong className="font-medium text-off-black">{reply.author.displayName}</strong> {reply.text}
        </span>
      ))}
      {item.replyCount > replies.length ? (
        <span className="mt-1 block text-[11px] text-lake-blue">View all {item.replyCount} replies</span>
      ) : null}
    </button>
  );
}

function Avatar({ name, current }: { name: string; current?: boolean }) {
  return (
    <div
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full border text-[10px] font-medium uppercase",
        current ? "border-lake-blue bg-lake-blue text-parchment" : "border-ash bg-white/70 text-graphite",
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

function kindLabel(item: RoomFeedItem): string {
  switch (item.kind) {
    case "event":
      return "Match event";
    case "call":
      return "TxLINE call";
    case "odds":
      return "Market says";
    case "receipt":
      return "Receipt";
    case "poll":
      return "Room poll";
    case "image":
      return "Image";
    case "text":
      return "Message";
    case "system":
      return "FullTime";
  }
}

function TypingPresence({ users }: { users: RoomMemberView[] }) {
  if (users.length === 0) return null;
  const names = users.slice(0, 2).map((user) => user.displayName);
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pb-3 text-caption text-smoke" aria-live="polite">
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span key={index} className="size-1 animate-pulse rounded-full bg-smoke" style={{ animationDelay: `${index * 140}ms` }} />
        ))}
      </span>
      {names.join(" and ")} {users.length === 1 ? "is" : "are"} typing
    </div>
  );
}

export function FeedKindIcon({ kind }: { kind: RoomFeedItem["kind"] }) {
  const props = { className: "size-4", "aria-hidden": true } as const;
  switch (kind) {
    case "image":
      return <ImageIcon {...props} />;
    case "event":
      return <Sparkles {...props} />;
    case "poll":
      return <Users {...props} />;
    case "call":
      return <ShieldCheck {...props} />;
    case "odds":
      return <TrendingUp {...props} />;
    case "receipt":
      return <ReceiptText {...props} />;
    default:
      return <MessageCircle {...props} />;
  }
}
