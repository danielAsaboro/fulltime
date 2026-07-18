"use client";

import { ArrowRight, LoaderCircle, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { RoomFeedItem, ThreadReply } from "@/lib/data";
import { useRoomThread } from "@/lib/data";
import { PeerAvatar } from "@/components/peer-avatar";
import { MessageContent } from "@/components/message-content";
import { FeedKindIcon } from "@/components/room-feed";
import { Sheet } from "@/components/ui/sheet";

const MAX_REPLY_LENGTH = 1_000;

export function RoomThreadOverlays({
  item,
  canParticipate,
  roomClosed = false,
  onClose,
  onRequireSignIn,
  onSend,
}: {
  item: RoomFeedItem | null;
  canParticipate: boolean;
  roomClosed?: boolean;
  onClose: () => void;
  onRequireSignIn: () => void;
  onSend: (itemId: string, text: string) => Promise<ThreadReply>;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getServerDesktopSnapshot);
  if (!item) return null;
  if (desktop) {
    return (
      <DesktopThread
        key={String(item.id)}
        item={item}
        canParticipate={canParticipate}
        roomClosed={roomClosed}
        onClose={onClose}
        onRequireSignIn={onRequireSignIn}
        onSend={onSend}
      />
    );
  }
  return (
    <Sheet open onClose={onClose} eyebrow="Thread" title={`${item.replyCount} ${item.replyCount === 1 ? "reply" : "replies"}`} className="max-h-[88dvh] p-0">
      <div className="flex h-[72dvh] flex-col border-t border-ash">
        <ThreadContent
          item={item}
          canParticipate={canParticipate}
          roomClosed={roomClosed}
          onRequireSignIn={onRequireSignIn}
          onSend={onSend}
        />
      </div>
    </Sheet>
  );
}

function subscribeDesktop(onChange: () => void): () => void {
  const media = window.matchMedia("(min-width: 1024px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getDesktopSnapshot(): boolean {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getServerDesktopSnapshot(): boolean {
  return false;
}

function DesktopThread({
  item,
  canParticipate,
  roomClosed,
  onClose,
  onRequireSignIn,
  onSend,
}: {
  item: RoomFeedItem;
  canParticipate: boolean;
  roomClosed: boolean;
  onClose: () => void;
  onRequireSignIn: () => void;
  onSend: (itemId: string, text: string) => Promise<ThreadReply>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <>
      <button type="button" className="fixed inset-0 z-40 cursor-default bg-off-black/15" onClick={onClose} aria-label="Close thread" />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-ash bg-parchment shadow-[-20px_0_50px_rgba(36,36,36,0.12)] outline-none"
      >
        <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-ash px-5">
          <div>
            <p className="text-caption uppercase tracking-[0.1em] text-smoke">Thread</p>
            <h2 id={titleId} className="text-label">{item.replyCount} {item.replyCount === 1 ? "reply" : "replies"}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full hover:bg-white" aria-label="Close thread">
            <X className="size-4.5" />
          </button>
        </div>
        <ThreadContent item={item} canParticipate={canParticipate} roomClosed={roomClosed} onRequireSignIn={onRequireSignIn} onSend={onSend} />
      </aside>
    </>
  );
}

function ThreadContent({
  item,
  canParticipate,
  roomClosed = false,
  onRequireSignIn,
  onSend,
}: {
  item: RoomFeedItem;
  canParticipate: boolean;
  roomClosed?: boolean;
  onRequireSignIn: () => void;
  onSend: (itemId: string, text: string) => Promise<ThreadReply>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRoomThread(String(item.roomId), String(item.id), item.replies);
  const replies = useMemo(
    () =>
      [...thread.replies].sort(
        (a, b) => Number(a.createdAt) - Number(b.createdAt) || String(a.id).localeCompare(String(b.id)),
      ),
    [thread.replies],
  );

  const send = async () => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    const clean = text.trim();
    if (!clean) return;
    setSending(true);
    setError(null);
    try {
      const reply = await onSend(String(item.id), clean);
      thread.addReply(reply);
      setText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reply could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ThreadSource item={item} />
        {thread.hasMore ? (
          <div className="border-b border-ash px-5 py-3 text-center">
            <button
              type="button"
              onClick={() => void thread.loadOlder()}
              disabled={thread.loadingOlder}
              className="inline-flex items-center gap-2 rounded-full border border-ash bg-white/45 px-3 py-1.5 text-caption text-smoke hover:text-off-black disabled:opacity-50"
            >
              {thread.loadingOlder ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              {thread.loadingOlder ? "Loading replies" : "Load older replies"}
            </button>
          </div>
        ) : null}
        {thread.error ? <p className="border-b border-ash px-5 py-2 text-caption text-crimson">{thread.error}</p> : null}
        <ol className="divide-y divide-ash/70 px-5">
          {replies.length ? (
            replies.map((reply) => (
              <li key={String(reply.id)} className="flex gap-3 py-4">
                <PeerAvatar
                  userId={reply.author.userId}
                  displayName={reply.author.displayName}
                  size="sm"
                  isCurrentUser={reply.author.isCurrentUser}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-medium text-off-black">{reply.author.displayName}</span>
                    <time className="text-[10px] text-smoke" dateTime={new Date(Number(reply.createdAt)).toISOString()}>
                      {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(Number(reply.createdAt)))}
                    </time>
                    {reply.editedAt ? <span className="text-[10px] text-smoke">edited</span> : null}
                  </div>
                  <div className="mt-1 text-body-sm"><MessageContent text={reply.text} /></div>
                  {reply.reactions.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {reply.reactions.map((reaction) => (
                        <span key={reaction.emoji} className="inline-flex items-center gap-1 rounded-full border border-ash px-1.5 py-0.5 text-[10px]">
                          {reaction.emoji} {reaction.count}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))
          ) : (
            <li className="grid place-items-center py-12 text-center">
              <MessageCircle className="size-5 text-smoke" aria-hidden />
              <p className="mt-2 text-body-sm text-smoke">Start a side conversation about this moment.</p>
            </li>
          )}
        </ol>
      </div>
      {roomClosed ? (
        <div className="shrink-0 border-t border-ash bg-parchment p-4 text-center text-caption text-smoke">
          Room closed · thread replies are read-only.
        </div>
      ) : <div className="shrink-0 border-t border-ash bg-parchment p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {error ? <p className="mb-2 text-caption text-crimson">{error}</p> : null}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 rounded-[16px] border border-ash bg-white/55 px-3 py-2 focus-within:border-off-black">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              maxLength={MAX_REPLY_LENGTH}
              rows={2}
              placeholder={canParticipate ? "Reply to thread" : "Sign in to reply"}
              aria-label="Reply to thread"
              className="max-h-24 w-full resize-none bg-transparent text-body-sm outline-none placeholder:text-smoke"
            />
            <p className="text-right text-[9px] tabular text-smoke">{text.length}/{MAX_REPLY_LENGTH}</p>
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-lake-blue text-parchment disabled:opacity-35"
            aria-label="Send reply"
          >
            {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>}
    </>
  );
}

function ThreadSource({ item }: { item: RoomFeedItem }) {
  const label = sourceLabel(item);
  return (
    <div className="border-b border-ash bg-white/35 px-5 py-4">
      <div className="flex items-center gap-2 text-caption uppercase tracking-[0.08em] text-smoke">
        <FeedKindIcon kind={item.kind} /> Original item
      </div>
      <div className="mt-2 flex items-start gap-2">
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-smoke" aria-hidden />
        <p className="line-clamp-3 text-body-sm text-off-black">{label}</p>
      </div>
      <p className="mt-2 text-[10px] text-smoke">
        {item.author?.displayName ?? "Room"} · {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(Number(item.createdAt)))}
      </p>
    </div>
  );
}

function sourceLabel(item: RoomFeedItem): string {
  switch (item.kind) {
    case "text":
      return item.text;
    case "poll":
      return item.poll.question;
    case "system":
      return item.text;
  }
}
