"use client";

/* Mock room media may use browser-local blob URLs. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock3,
  Copy,
  Link2,
  ListTree,
  LockKeyhole,
  ReceiptText,
  Share2,
  Users,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { CalibrationMethod } from "@fulltime/shared";
import type { RoomDetailsView as RoomDetailsModel, RoomFeedItem } from "@/lib/data";
import { useCalibration, useData, useRoom, useRoomState } from "@/lib/data";
import { cn } from "@/lib/cn";
import { CalibrationSheet } from "@/components/calibration-sheet";
import { EventFeed } from "@/components/event-feed";
import { PollCard } from "@/components/poll-card";
import { ReceiptChip } from "@/components/receipt-chip";
import { RoomComposer } from "@/components/room-composer";
import { CompactInviteCard, RoomDetails, RoomMemberList } from "@/components/room-details";
import { RoomFeed } from "@/components/room-feed";
import { RoomThreadOverlays } from "@/components/room-thread";
import { SignInModal } from "@/components/sign-in-modal";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";

type RoomTab = "chat" | "polls" | "details";
type MobileSheet = "timeline" | "receipts" | "members" | null;
type PollIndex = "active" | "completed";

export function RoomView({ roomId, demo = false }: { roomId: string; demo?: boolean }) {
  const room = useRoom(roomId);
  const live = useRoomState(roomId);
  const calibration = useCalibration(roomId);
  const { client, session } = useData();

  const [tab, setTab] = useState<RoomTab>("chat");
  const [pollIndex, setPollIndex] = useState<PollIndex>("active");
  const [signInOpen, setSignInOpen] = useState(false);
  const [calibrateOpen, setCalibrateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [threadItemId, setThreadItemId] = useState<string | null>(null);
  const [localDelay, setLocalDelay] = useState<{ userId: string | null; seconds: number } | null>(null);
  const [details, setDetails] = useState<RoomDetailsModel | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const state = live.data;
  const detailsRevision = state
    ? `${state.items.length}:${state.fanIq.fanIq}:${state.fanIq.roomRank}:${state.members.map((member) => `${member.userId}:${member.role}:${member.isOnline}`).join("|")}`
    : "loading";

  const loadDetails = useCallback(async () => {
    const next = await client.getRoomDetails(roomId);
    setDetails(next);
  }, [client, roomId]);

  useEffect(() => {
    let alive = true;
    client.getRoomDetails(roomId).then((next) => {
      if (alive) setDetails(next);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [client, detailsRevision, roomId]);

  const selectedThread = useMemo(
    () => state?.items.find((item) => String(item.id) === threadItemId) ?? null,
    [state?.items, threadItemId],
  );
  const delaySeconds = localDelay?.userId === (session?.userId ?? null)
    ? localDelay.seconds
    : calibration.data?.delaySeconds ?? null;

  useEffect(() => {
    if (!state?.items.length || typeof window === "undefined") return;
    const requested = new URLSearchParams(window.location.search).get("item");
    if (!requested) return;
    const target = document.getElementById(requested);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.classList.add("ring-1", "ring-lake-blue");
      window.setTimeout(() => target.classList.remove("ring-1", "ring-lake-blue"), 2_500);
    });
  }, [state?.items.length]);

  if (room.status === "loading" || (live.status === "loading" && !live.data)) return <RoomSkeleton />;
  if (room.status === "empty" || room.status === "error" || !room.data) {
    return (
      <RoomFrame>
        {room.status === "error" ? <ErrorState hint={room.error ?? undefined} onRetry={room.reload} /> : (
          <EmptyState title="Room not found" hint="This invite-only room is not open. Pick a fixture and create your own." action={<Button href="/matches" variant="ghost" size="sm">See fixtures</Button>} />
        )}
      </RoomFrame>
    );
  }
  if (live.status === "error" || !state) {
    return <RoomFrame><ErrorState title="Room reconnecting" hint={live.error ?? "Messages and calls are paused until the feed is back."} onRetry={live.reload} /></RoomFrame>;
  }

  const { fixture } = room.data;
  const canParticipate = Boolean(session) && details?.isClosed !== true;
  const canInvite = Boolean(
    details
      && !details.isClosed
      && (details.permissions.canInvite || details.permissions.canRegenerateInvite),
  );
  const onSaveCalibration = (seconds: number, method: CalibrationMethod) => {
    setLocalDelay({ userId: session?.userId ?? null, seconds });
    void client.setCalibration(roomId, seconds, method);
  };
  const requireSession = (action: () => void) => {
    if (details?.isClosed) return;
    if (!session) setSignInOpen(true);
    else action();
  };
  const openImage = (url: string, alt: string) => setLightbox({ url, alt });

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-parchment">
      <RoomHeader
        roomName={details?.room.name ?? room.data.room.name}
        homeName={fixture.home.shortName ?? fixture.home.name.slice(0, 3).toUpperCase()}
        awayName={fixture.away.shortName ?? fixture.away.name.slice(0, 3).toUpperCase()}
        score={state.fixtureState.score}
        minute={state.fixtureState.minute}
        status={state.fixtureState.status}
        delaySeconds={delaySeconds}
        members={state.members}
        unreadCount={state.unreadState.count}
        onCalibrate={() => setCalibrateOpen(true)}
        onMembers={() => setMobileSheet("members")}
        onInvite={() => setInviteOpen(true)}
        canInvite={canInvite}
      />

      <main className="min-h-0 flex-1">
        <Container className="grid h-full min-h-0 px-0 sm:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)] lg:gap-5">
          <section className="flex min-h-0 min-w-0 flex-col border-x border-ash">
            <RoomTabs tab={tab} unread={state.unreadState.count} pollCount={state.items.filter((item) => item.kind === "poll").length} onChange={setTab} />
            <MobileRoomTools
              timelineCount={state.timeline.length}
              receiptCount={state.receipts.length}
              memberCount={state.members.length}
              onOpen={setMobileSheet}
            />
            {demo ? <DemoNotice /> : null}

            {tab === "chat" ? (
              <>
                {state.phase === "finished" ? (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ash bg-periwinkle-mist/40 px-4 py-2 text-caption sm:px-6">
                    <span>Full-time · your prediction report is ready.</span>
                    <Link href={`/room/${roomId}/report`} className="uppercase tracking-[0.08em] text-lake-blue">View report →</Link>
                  </div>
                ) : null}
                <RoomFeed
                  items={state.items}
                  unreadState={state.unreadState}
                  typingUsers={state.typingUsers}
                  canParticipate={canParticipate}
                  onRequireSignIn={() => { if (!session) setSignInOpen(true); }}
                  onReact={(itemId, emoji) => client.reactToItem(roomId, itemId, emoji)}
                  onRead={(itemId) => client.markRoomRead(roomId, itemId)}
                  onReply={(item) => setThreadItemId(String(item.id))}
                  onVote={(pollId, optionId) => requireSession(() => void client.votePoll(roomId, pollId, optionId))}
                  onAnswer={(callId, optionId) => requireSession(() => void client.submitAnswer(roomId, callId, optionId))}
                  onOpenImage={openImage}
                />
                <RoomComposer
                  canParticipate={canParticipate}
                  roomClosed={details?.isClosed}
                  slowModeSeconds={details?.slowModeSeconds}
                  onRequireSignIn={() => setSignInOpen(true)}
                  onSend={(input) => client.sendMessage(roomId, input).then(() => undefined)}
                  onCreatePoll={(input) => client.createPoll(roomId, input).then(() => undefined)}
                />
              </>
            ) : null}

            {tab === "polls" ? (
              <PollsIndex
                items={state.items.filter((item): item is Extract<RoomFeedItem, { kind: "poll" }> => item.kind === "poll")}
                phase={state.phase}
                index={pollIndex}
                onIndex={setPollIndex}
                canVote={canParticipate}
                onVote={(pollId, option) => requireSession(() => void client.votePoll(roomId, pollId, option))}
              />
            ) : null}

            {tab === "details" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <RoomDetails roomId={roomId} details={details} client={client} onReload={loadDetails} onCalibrate={() => setCalibrateOpen(true)} onOpenInvite={() => setInviteOpen(true)} onOpenImage={openImage} />
              </div>
            ) : null}
          </section>

          <RoomSidebar
            roomId={roomId}
            state={state}
            details={details}
            onInvite={() => setInviteOpen(true)}
          />
        </Container>
      </main>

      <RoomThreadOverlays
        item={selectedThread}
        canParticipate={canParticipate}
        roomClosed={Boolean(details?.isClosed)}
        onClose={() => setThreadItemId(null)}
        onRequireSignIn={() => { if (!session) setSignInOpen(true); }}
        onSend={(itemId, text) => client.sendReply(roomId, itemId, { text }).then(() => undefined)}
      />
      <RoomMobileSheets sheet={mobileSheet} onClose={() => setMobileSheet(null)} state={state} />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} details={details} roomId={roomId} client={client} onReload={loadDetails} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} onSignedIn={() => { live.reload(); void loadDetails(); }} />
      <CalibrationSheet open={calibrateOpen} onClose={() => setCalibrateOpen(false)} initialSeconds={delaySeconds} onSave={onSaveCalibration} />
      {lightbox ? <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

function DemoNotice() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-lake-blue/20 bg-periwinkle-mist/45 px-3 py-2 font-mono text-[10px] text-graphite sm:px-6">
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-lake-blue" aria-hidden />
      <span className="min-w-0 flex-1">
        Guided demo · advances about every 8 seconds · use <strong className="font-medium text-off-black">● Mock</strong> to jump to any match beat
      </span>
    </div>
  );
}

function RoomHeader({
  roomName,
  homeName,
  awayName,
  score,
  minute,
  status,
  delaySeconds,
  members,
  unreadCount,
  onCalibrate,
  onMembers,
  onInvite,
  canInvite,
}: {
  roomName: string;
  homeName: string;
  awayName: string;
  score: { home: number; away: number };
  minute: number | null;
  status: string;
  delaySeconds: number | null;
  members: RoomDetailsModel["members"];
  unreadCount: number;
  onCalibrate: () => void;
  onMembers: () => void;
  onInvite: () => void;
  canInvite: boolean;
}) {
  const live = ["first-half", "second-half", "extra-time", "penalty-shootout", "half-time"].includes(status);
  return (
    <header className="z-30 h-[104px] shrink-0 border-b border-ash bg-parchment/98 backdrop-blur">
      <Container className="h-full px-3 sm:px-8">
        <div className="flex h-[49px] items-center gap-3 border-b border-ash/65">
          <Link href="/matches" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-white" aria-label="Back to fixtures"><ChevronLeft className="size-4" /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-3 shrink-0 text-smoke" aria-hidden />
              <h1 className="truncate font-mono text-body-sm font-medium">{roomName}</h1>
              {unreadCount ? <span className="rounded-full bg-lake-blue px-1.5 py-0.5 text-[9px] text-parchment">{unreadCount}</span> : null}
            </div>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-smoke">Invite-only match room</p>
          </div>
          <button type="button" onClick={onMembers} className="hidden items-center gap-2 rounded-full border border-ash px-2 py-1.5 sm:flex" aria-label={`${members.length} members`}>
            <span className="flex -space-x-1.5">
              {members.slice(0, 3).map((member) => <span key={String(member.userId)} className="grid size-5 place-items-center rounded-full border border-parchment bg-periwinkle-mist text-[7px]">{member.displayName.slice(0, 1).toUpperCase()}</span>)}
            </span>
            <span className="text-[10px] text-smoke">{members.length}</span>
          </button>
          <Button type="button" size="sm" className="px-3 sm:px-5" onClick={onInvite} disabled={!canInvite}><Link2 className="size-3.5" /><span className="hidden sm:inline">Invite</span></Button>
        </div>
        <div className="flex h-[54px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-caption uppercase tracking-[0.08em]"><span className="truncate sm:min-w-14">{homeName}</span><strong className="text-label tabular">{score.home}–{score.away}</strong><span className="truncate text-right sm:min-w-14">{awayName}</span></div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-caption uppercase tracking-[0.08em] text-graphite">{live ? <span className="size-1.5 animate-pulse rounded-full bg-crimson" /> : null}{minute != null ? `${minute}'` : status.replaceAll("-", " ")}</span>
            <button type="button" onClick={onCalibrate} className="inline-flex items-center gap-1 rounded-full border border-ash px-2.5 py-1.5 text-[10px] uppercase tracking-[0.06em] text-smoke hover:text-off-black"><Clock3 className="size-3" />{delaySeconds != null ? `+${delaySeconds}s` : "Sync"}</button>
          </div>
        </div>
      </Container>
    </header>
  );
}

function RoomTabs({ tab, unread, pollCount, onChange }: { tab: RoomTab; unread: number; pollCount: number; onChange: (tab: RoomTab) => void }) {
  const tabs: Array<{ id: RoomTab; label: string; count?: number }> = [{ id: "chat", label: "Chat", count: unread }, { id: "polls", label: "Polls", count: pollCount }, { id: "details", label: "Room details" }];
  return (
    <nav className="flex h-[49px] shrink-0 border-b border-ash bg-parchment" aria-label="Room views">
      {tabs.map((item) => <button key={item.id} type="button" onClick={() => onChange(item.id)} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-caption uppercase tracking-[0.08em] text-smoke", tab === item.id && "text-off-black after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-off-black")} aria-current={tab === item.id ? "page" : undefined}>{item.label}{item.count ? <span className="rounded-full bg-periwinkle-mist px-1.5 py-0.5 text-[9px] text-off-black">{item.count}</span> : null}</button>)}
    </nav>
  );
}

function MobileRoomTools({ timelineCount, receiptCount, memberCount, onOpen }: { timelineCount: number; receiptCount: number; memberCount: number; onOpen: (sheet: Exclude<MobileSheet, null>) => void }) {
  return <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-ash px-2 lg:hidden"><ToolButton icon={<ListTree className="size-3.5" />} label="Timeline" count={timelineCount} onClick={() => onOpen("timeline")} /><ToolButton icon={<ReceiptText className="size-3.5" />} label="Receipts" count={receiptCount} onClick={() => onOpen("receipts")} /><ToolButton icon={<Users className="size-3.5" />} label="Members" count={memberCount} onClick={() => onOpen("members")} /></div>;
}

function ToolButton({ icon, label, count, onClick }: { icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] text-smoke hover:bg-white hover:text-off-black">{icon}{label}<span className="tabular">{count}</span></button>;
}

function PollsIndex({ items, phase, index, onIndex, canVote, onVote }: { items: Extract<RoomFeedItem, { kind: "poll" }>[]; phase: string; index: PollIndex; onIndex: (index: PollIndex) => void; canVote: boolean; onVote: (pollId: string, option: string) => void }) {
  const completed = (item: Extract<RoomFeedItem, { kind: "poll" }>) => phase === "finished" || (item.poll as typeof item.poll & { status?: string }).status === "completed";
  const visible = items.filter((item) => (index === "completed" ? completed(item) : !completed(item)));
  const activeCount = items.filter((item) => !completed(item)).length;
  const completedCount = items.length - activeCount;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 flex border-b border-ash bg-parchment px-4 py-3 sm:px-6"><IndexButton active={index === "active"} label="Active" count={activeCount} onClick={() => onIndex("active")} /><IndexButton active={index === "completed"} label="Completed" count={completedCount} onClick={() => onIndex("completed")} /></div>
      <div className="mx-auto max-w-3xl space-y-4 px-3 py-5 sm:px-6">{visible.length ? visible.map((item) => <div key={String(item.id)}><div className="mb-1.5 flex items-center justify-between text-caption text-smoke"><span>{item.author?.displayName ?? "Room poll"}</span><span>{item.matchMinute != null ? `${item.matchMinute}'` : "Room time"}</span></div><PollCard key={`${item.id}:${item.myVote ?? "none"}`} poll={item.poll} myVote={item.myVote} canVote={canVote && !completed(item)} onVote={(option) => onVote(String(item.poll.id), option)} className="rounded-[18px] bg-white/40 p-5" /></div>) : <EmptyState title={`No ${index} polls`} hint={index === "active" ? "Create a poll from the Chat composer." : "Completed room polls collect here."} className="rounded-[18px]" />}</div>
    </div>
  );
}

function IndexButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("border-b px-4 py-1.5 text-caption uppercase tracking-[0.08em]", active ? "border-off-black text-off-black" : "border-transparent text-smoke")}>{label} · {count}</button>;
}

function RoomSidebar({ roomId, state, details, onInvite }: { roomId: string; state: NonNullable<ReturnType<typeof useRoomState>["data"]>; details: RoomDetailsModel | null; onInvite: () => void }) {
  const [timelineOpen, setTimelineOpen] = useStoredPanel(`fulltime:${roomId}:timeline`, true);
  const [receiptsOpen, setReceiptsOpen] = useStoredPanel(`fulltime:${roomId}:receipts`, true);
  return (
    <aside className="hidden min-h-0 overflow-y-auto py-5 lg:block">
      <div className="space-y-4">
        {details && !details.isClosed && details.permissions.canInvite ? <CompactInviteCard details={details} onOpen={onInvite} /> : null}
        <div className="grid grid-cols-3 gap-px border border-ash bg-ash"><MiniStat label="Rank" value={state.fanIq.roomRank ? `#${state.fanIq.roomRank}` : "—"} /><MiniStat label="Fan IQ" value={state.fanIq.fanIq} /><MiniStat label="Pressure" value={`${Math.round(state.pressure * 100)}%`} /></div>
        <SidebarPanel title="Receipts" count={state.receipts.length} open={receiptsOpen} onToggle={() => setReceiptsOpen(!receiptsOpen)} icon={<ReceiptText className="size-4" />} collapsed={<ReceiptList receipts={state.receipts.slice(0, 1)} />}><ReceiptList receipts={state.receipts} /></SidebarPanel>
        <SidebarPanel title="Timeline" count={state.timeline.length} open={timelineOpen} onToggle={() => setTimelineOpen(!timelineOpen)} icon={<ListTree className="size-4" />} collapsed={<EventFeed items={state.timeline.slice(0, 1)} />}><EventFeed items={state.timeline} /></SidebarPanel>
      </div>
    </aside>
  );
}

function SidebarPanel({ title, count, open, onToggle, icon, collapsed, children }: { title: string; count: number; open: boolean; onToggle: () => void; icon: React.ReactNode; collapsed: React.ReactNode; children: React.ReactNode }) {
  return <section className="border border-ash bg-white/35"><button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left"><span className="text-smoke">{icon}</span><span className="flex-1 text-caption uppercase tracking-[0.09em]">{title}</span><span className="text-[10px] tabular text-smoke">{count}</span>{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button><div className="border-t border-ash px-4">{open ? children : collapsed}</div></section>;
}

function ReceiptList({ receipts }: { receipts: NonNullable<ReturnType<typeof useRoomState>["data"]>["receipts"] }) {
  if (!receipts.length) return <p className="py-6 text-center text-caption text-smoke">Receipts land after verified moments.</p>;
  return <ul className="divide-y divide-ash">{receipts.map((view) => <li key={String(view.receipt.id)} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0 flex-1 truncate text-caption">{view.headline}</span><ReceiptChip state={view.receipt.state} receiptId={String(view.receipt.id)} /></li>)}</ul>;
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) { return <div className="bg-parchment px-3 py-3"><p className="text-[9px] uppercase tracking-[0.08em] text-smoke">{label}</p><p className="mt-1 text-body-sm font-medium tabular">{value}</p></div>; }

function useStoredPanel(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === key) onChange(); };
    const onLocalChange = () => onChange();
    window.addEventListener("storage", onStorage);
    window.addEventListener("fulltime-panel-storage", onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("fulltime-panel-storage", onLocalChange);
    };
  }, [key]);
  const getSnapshot = useCallback(() => window.localStorage.getItem(key) ?? String(initial), [initial, key]);
  const getServerSnapshot = useCallback(() => String(initial), [initial]);
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) === "true";
  const update = (value: boolean) => {
    window.localStorage.setItem(key, String(value));
    window.dispatchEvent(new Event("fulltime-panel-storage"));
  };
  return [open, update];
}

function RoomMobileSheets({ sheet, onClose, state }: { sheet: MobileSheet; onClose: () => void; state: NonNullable<ReturnType<typeof useRoomState>["data"]> }) {
  return (
    <>
      <Sheet open={sheet === "timeline"} onClose={onClose} eyebrow="Match room" title={`Timeline · ${state.timeline.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><EventFeed items={state.timeline} /></div></Sheet>
      <Sheet open={sheet === "receipts"} onClose={onClose} eyebrow="Verified moments" title={`Receipts · ${state.receipts.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><ReceiptList receipts={state.receipts} /></div></Sheet>
      <Sheet open={sheet === "members"} onClose={onClose} eyebrow="Invite-only room" title={`Members · ${state.members.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><RoomMemberList members={state.members} /></div></Sheet>
    </>
  );
}

function InviteSheet({ open, onClose, details, roomId, client, onReload }: { open: boolean; onClose: () => void; details: RoomDetailsModel | null; roomId: string; client: ReturnType<typeof useData>["client"]; onReload: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relative = details?.invite?.url ?? "";
  const absolute = typeof window === "undefined" || !relative ? relative : new URL(relative, window.location.origin).toString();
  const copy = async () => { if (!absolute) return; await navigator.clipboard.writeText(absolute); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); };
  const share = async () => { if (!absolute) return; if (navigator.share) await navigator.share({ title: details?.room.name ?? "FullTime room", text: "Join my private match room on FullTime.", url: absolute }); else await copy(); };
  const create = async () => { setBusy(true); setError(null); try { await client.createInvite(roomId); await onReload(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Invite could not be created."); } finally { setBusy(false); } };
  const mayCreate = Boolean(details && !details.isClosed && details.permissions.canRegenerateInvite);
  return <Sheet open={open} onClose={onClose} eyebrow="Invite-only" title="Bring your people"><div className="space-y-5">{details?.invite && details.invite.status === "active" && !details.isClosed ? <><div className="mx-auto grid size-48 place-items-center bg-white p-3"><QRCodeSVG value={absolute} size={164} level="M" /></div><div className="border border-ash bg-white/45 p-3"><p className="truncate text-caption">{absolute}</p><p className="mt-1 text-[10px] text-smoke">Code · {details.invite.code}</p></div><div className="grid grid-cols-2 gap-2"><Button type="button" variant="primary" size="sm" onClick={() => void copy()}>{copied ? <><Copy className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy link</>}</Button><Button type="button" variant="ghost" size="sm" onClick={() => void share()}><Share2 className="size-3.5" /> Share</Button></div><div className="bg-periwinkle-mist/40 p-3 text-center"><p className="text-label">{details.invite.viewerSuccessfulJoins} friends joined through you</p><p className="mt-1 text-[10px] text-smoke">Only unique successful joins add Influence.</p></div></> : <><div className="grid place-items-center py-8 text-center"><LockKeyhole className="size-6 text-smoke" /><p className="mt-3 text-body-sm text-smoke">{details?.isClosed ? "This room is closed and no longer accepts invites." : "There is no active invite for this room."}</p></div>{error ? <p className="text-caption text-crimson">{error}</p> : null}{mayCreate ? <Button type="button" fullWidth disabled={busy} onClick={() => void create()}>Create invite</Button> : null}</>}</div></Sheet>;
}

function ImageLightbox({ image, onClose }: { image: { url: string; alt: string }; onClose: () => void }) {
  const closeRef = useRef(onClose);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); if (event.key === "Tab") { event.preventDefault(); buttonRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    buttonRef.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-off-black/90 p-4" role="dialog" aria-modal="true" aria-label={image.alt}><button ref={buttonRef} type="button" onClick={onClose} className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-parchment text-off-black" aria-label="Close image"><X className="size-5" /></button><img src={image.url} alt={image.alt} className="max-h-[90dvh] max-w-full object-contain" /></div>;
}

function RoomFrame({ children }: { children: React.ReactNode }) { return <div className="flex min-h-dvh flex-col"><header className="border-b border-ash"><Container className="flex h-[72px] items-center justify-between"><Logo /><Link href="/matches" className="text-body-sm uppercase tracking-[0.06em] text-graphite">Fixtures</Link></Container></header><main className="flex flex-1 items-center"><Container className="py-16">{children}</Container></main></div>; }

function RoomSkeleton() { return <div className="flex h-dvh flex-col"><header className="h-[104px] border-b border-ash"><Container className="space-y-3 py-3"><Skeleton className="h-7 w-52" /><Skeleton className="h-10 w-full" /></Container></header><main className="min-h-0 flex-1"><Container className="grid h-full px-0 sm:px-8 lg:grid-cols-[2fr_1fr] lg:gap-5"><div className="space-y-4 border-x border-ash p-5"><Skeleton className="h-10" /><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div><div className="hidden space-y-4 py-5 lg:block"><Skeleton className="h-24" /><Skeleton className="h-64" /></div></Container></main></div>; }
