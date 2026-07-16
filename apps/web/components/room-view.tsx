"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronUp, Copy, Link2, ListTree, LockKeyhole, ReceiptText, Share2, Sparkles, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { projectMatchStory } from "@fulltime/shared";
import { AccountSettingsButton } from "@/components/account-settings";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { RoomDetailsView as RoomDetailsModel, RoomFeedItem } from "@/lib/data";
import { useData, useRoom, useRoomHistory, useRoomState } from "@/lib/data";
import { cn } from "@/lib/cn";
import { PollCard } from "@/components/poll-card";
import { CallCard } from "@/components/call-card";
import { EventFeed } from "@/components/event-feed";
import { FanIqStrip } from "@/components/fan-iq-strip";
import { MarketSaysCard } from "@/components/market-says-card";
import { MatchCalloutToggle, useRoomRadio } from "@/components/match-callouts";
import { MatchStoryCard } from "@/components/match-story-card";
import { PressureIndicator } from "@/components/pressure-indicator";
import { ReceiptChip } from "@/components/receipt-chip";
import { RoomComposer } from "@/components/room-composer";
import { CompactInviteCard, RoomDetails, RoomMemberList } from "@/components/room-details";
import { RoomFeed } from "@/components/room-feed";
import { RoomThreadOverlays } from "@/components/room-thread";
import { Scoreline } from "@/components/scoreline";
import { PeerAvatar } from "@/components/peer-avatar";
import { SeedBanterStrip } from "@/components/seed-banter";
import { SignInModal } from "@/components/sign-in-modal";
import { Button } from "@/components/ui/button";
import { Container, EmptyState, ErrorState, Logo, Skeleton } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";

type RoomTab = "chat" | "polls" | "details";
type MobileSheet = "calls" | "timeline" | "receipts" | "members" | "pulse" | null;
type PollStage = "active" | "completed";
const EMPTY_ROOM_ITEMS: readonly RoomFeedItem[] = [];

export function RoomView({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const live = useRoomState(roomId);
  const { client, session } = useData();
  const [tab, setTab] = useState<RoomTab>("chat");
  const [pollStage, setPollStage] = useState<PollStage>("active");
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [threadItemId, setThreadItemId] = useState<string | null>(null);
  const [details, setDetails] = useState<RoomDetailsModel | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const state = live.data;
  const history = useRoomHistory(roomId, state?.items ?? EMPTY_ROOM_ITEMS);
  const detailsRevision = state
    ? `${state.items.length}:${state.members.map((member) => `${member.userId}:${member.role}:${member.isOnline}`).join("|")}`
    : "loading";

  const loadDetails = useCallback(async () => {
    setDetails(await client.getRoomDetails(roomId));
  }, [client, roomId]);

  useEffect(() => {
    let alive = true;
    client.getRoomDetails(roomId).then((next) => {
      if (alive) setDetails(next);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [client, detailsRevision, roomId]);

  const selectedThread = useMemo(
    () => history.items.find((item) => String(item.id) === threadItemId) ?? null,
    [history.items, threadItemId],
  );

  if (room.status === "loading" || (live.status === "loading" && !state)) return <RoomSkeleton />;
  if (room.status === "empty" || room.status === "error" || !room.data) {
    return (
      <RoomFrame>
        {room.status === "error" ? <ErrorState hint={room.error ?? undefined} onRetry={room.reload} /> : (
          <EmptyState title="Room not found" hint="This room is unavailable or no longer stored on this device." action={<Button href="/matches" variant="ghost" size="sm">See fixtures</Button>} />
        )}
      </RoomFrame>
    );
  }
  if (live.status === "error" || !state) {
    return <RoomFrame><ErrorState title="Room reconnecting" hint={live.error ?? "Chat is paused until the peer connection returns."} onRetry={live.reload} /></RoomFrame>;
  }

  const canParticipate = Boolean(session) && details?.isClosed !== true;
  const canInvite = Boolean(details && !details.isClosed && (details.permissions.canInvite || details.permissions.canRegenerateInvite));
  const polls = history.items.filter((item): item is Extract<RoomFeedItem, { kind: "poll" }> => item.kind === "poll");
  const requireSession = (action: () => void) => {
    if (!session) setSignInOpen(true);
    else if (!details?.isClosed) action();
  };
  const perform = (action: () => Promise<unknown>) => {
    setActionError(null);
    void action().catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : "That room action could not be completed."));
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-parchment">
      <RoomHeader
        roomName={details?.room.name ?? room.data.room.name}
        fixture={state.fixture}
        members={state.members}
        unreadCount={state.unreadState.count}
        onInvite={() => setInviteOpen(true)}
        onMembers={() => setTab("details")}
        canInvite={canInvite}
      />

      <main className="min-h-0 flex-1">
        <Container className="grid h-full min-h-0 px-0 sm:px-8 lg:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)] lg:gap-5">
          <section className="flex h-full min-h-0 min-w-0 flex-col border-x border-ash">
            <RoomTabs tab={tab} unread={state.unreadState.count} pollCount={polls.length} onChange={setTab} />
            {actionError ? <div className="flex shrink-0 items-center justify-between gap-3 border-b border-crimson/20 bg-coral/15 px-4 py-2 font-mono text-caption text-crimson" role="alert"><span>{actionError}</span><button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error">×</button></div> : null}
            <MobileRoomTools calls={state.calls.length} timeline={state.timeline.length} receipts={state.receipts.length} members={state.members.length} marketSays={state.marketSays.length} onOpen={setMobileSheet} />

            {tab === "chat" ? (
              <>
                {history.items.length < 4 ? (
                  <SeedBanterStrip
                    fixture={state.fixture.fixture}
                    roomName={details?.room.name ?? room.data.room.name}
                    canPost={canParticipate}
                    onPick={(text) => {
                      if (!canParticipate) {
                        setSignInOpen(true);
                        return;
                      }
                      setComposerDraft(text);
                    }}
                  />
                ) : null}
                <RoomFeed
                  items={history.items}
                  hasOlder={history.hasMore}
                  loadingOlder={history.loadingOlder}
                  historyError={history.error}
                  onLoadOlder={history.loadOlder}
                  unreadState={state.unreadState}
                  typingUsers={state.typingUsers}
                  canParticipate={canParticipate}
                  onRequireSignIn={() => setSignInOpen(true)}
                  onReact={(itemId, emoji) => client.reactToItem(roomId, itemId, emoji)}
                  onRead={(itemId) => client.markRoomRead(roomId, itemId)}
                  onReply={(item) => setThreadItemId(String(item.id))}
                  onVote={(pollId, optionId) => requireSession(() => perform(() => client.votePoll(roomId, pollId, optionId)))}
                  onDownloadAttachment={(itemId) => client.downloadAttachment(roomId, itemId)}
                  fixture={state.fixture.fixture}
                  onAttachMarket={(input) => client.attachMarketReference(roomId, input).then(() => undefined)}
                />
                <RoomComposer
                  canParticipate={canParticipate}
                  roomClosed={details?.isClosed}
                  slowModeSeconds={details?.slowModeSeconds}
                  onRequireSignIn={() => setSignInOpen(true)}
                  onSend={(input) => client.sendMessage(roomId, input).then(() => {
                    setComposerDraft("");
                  })}
                  onSendAttachment={(file, text) => client.uploadAttachment(roomId, file, text).then(() => {
                    setComposerDraft("");
                  })}
                  onCreatePoll={(input) => client.createPoll(roomId, input)}
                  fixture={state.fixture.fixture}
                  onAttachMarket={(input) => client.attachMarketReference(roomId, input).then(() => undefined)}
                  onTypingChange={(typing) => { void client.setTyping(roomId, typing).catch(() => undefined); }}
                  draftText={composerDraft}
                  onDraftTextChange={setComposerDraft}
                />
              </>
            ) : null}

            {tab === "polls" ? (
              <PollIndex
                items={polls}
                stage={pollStage}
                onStage={setPollStage}
                canVote={canParticipate}
                onVote={(pollId, option) => requireSession(() => perform(() => client.votePoll(roomId, pollId, option)))}
                fixture={state.fixture.fixture}
                onAttachMarket={(input) => client.attachMarketReference(roomId, input).then(() => undefined)}
              />
            ) : null}

            {tab === "details" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <RoomDetails roomId={roomId} details={details} client={client} onReload={loadDetails} onOpenInvite={() => setInviteOpen(true)} />
              </div>
            ) : null}
          </section>
          <RoomOverviewSidebar roomId={roomId} state={state} details={details} canParticipate={canParticipate} onAnswer={(callId, optionId) => client.submitAnswer(roomId, callId, optionId).then(() => undefined).catch((reason) => { setActionError(reason instanceof Error ? reason.message : "The answer could not be recorded."); throw reason; })} onInvite={() => setInviteOpen(true)} />
        </Container>
      </main>

      <RoomThreadOverlays
        item={selectedThread}
        canParticipate={canParticipate}
        roomClosed={Boolean(details?.isClosed)}
        onClose={() => setThreadItemId(null)}
        onRequireSignIn={() => setSignInOpen(true)}
        onSend={(itemId, text) => client.sendReply(roomId, itemId, { text })}
      />
      <RoomMobileSheets sheet={mobileSheet} onClose={() => setMobileSheet(null)} roomId={roomId} state={state} canParticipate={canParticipate} onAnswer={(callId, optionId) => client.submitAnswer(roomId, callId, optionId).then(() => undefined)} />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} details={details} roomId={roomId} onReload={loadDetails} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} onSignedIn={() => { live.reload(); void loadDetails(); }} />
    </div>
  );
}

function RoomOverviewSidebar({ roomId, state, details, canParticipate, onAnswer, onInvite }: { roomId: string; state: import("@/lib/data").RoomLiveState; details: RoomDetailsModel | null; canParticipate: boolean; onAnswer: (callId: string, optionId: string) => Promise<void>; onInvite(): void }) {
  const [callsOpen, setCallsOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const match = state.fixture.fixture;
  const story = useMemo(
    () =>
      projectMatchStory({
        fixtureId: match.id,
        homeName: match.home.shortName ?? match.home.name,
        awayName: match.away.shortName ?? match.away.name,
        events: state.timeline,
        pressure: state.pressure,
        minute: state.fixture.minute,
        phase: state.fixture.phase,
      }),
    [match, state.fixture.minute, state.fixture.phase, state.pressure, state.timeline],
  );
  useRoomRadio(roomId, state);
  const latestMarketSays = state.marketSays.slice(-3).reverse();
  return (
    <aside className="hidden min-h-0 overflow-y-auto py-5 lg:block">
      <div className="space-y-4">
        <section className="border border-ash bg-white/35 p-5"><Scoreline home={state.fixture.fixture.home} away={state.fixture.fixture.away} score={state.fixture.score} status={state.fixture.status} minute={state.fixture.minute} /><PressureIndicator pressure={state.pressure} className="mt-5 border-t border-ash pt-4" /></section>
        <MatchStoryCard story={story} />
        {latestMarketSays.length ? (
          <div className="space-y-2">
            {latestMarketSays.map((card) => (
              <MarketSaysCard key={card.id} card={card} />
            ))}
          </div>
        ) : null}
        <FanIqStrip iq={state.fanIq} receipts={state.receipts} />
        {details && !details.isClosed && details.permissions.canInvite ? <CompactInviteCard details={details} onOpen={onInvite} /> : null}
        <SidebarPanel title="Timeline" count={state.timeline.length} open={timelineOpen} onToggle={() => setTimelineOpen(!timelineOpen)} icon={<ListTree className="size-4" />}><EventFeed events={timelineOpen ? state.timeline : state.timeline.slice(-1)} /></SidebarPanel>
        <SidebarPanel title="Receipts" count={state.receipts.length} open={receiptsOpen} onToggle={() => setReceiptsOpen(!receiptsOpen)} icon={<ReceiptText className="size-4" />}><ReceiptList receipts={receiptsOpen ? state.receipts : state.receipts.slice(-1)} /></SidebarPanel>
        <SidebarPanel title="Match calls" count={state.calls.length} open={callsOpen} onToggle={() => setCallsOpen(!callsOpen)} icon={<LockKeyhole className="size-4" />}><CallList roomId={roomId} state={state} canParticipate={canParticipate} onAnswer={onAnswer} compact={!callsOpen} /></SidebarPanel>
      </div>
    </aside>
  );
}

function SidebarPanel({ title, count, open, onToggle, icon, children }: { title: string; count: number; open: boolean; onToggle: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <section className="border border-ash bg-white/35"><button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left"><span className="text-smoke">{icon}</span><span className="flex-1 font-mono text-caption uppercase tracking-[0.09em]">{title}</span><span className="text-[10px] tabular text-smoke">{count}</span>{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button><div className="border-t border-ash px-4">{children}</div></section>; }

function ReceiptList({ receipts }: { receipts: import("@/lib/data").RoomLiveState["receipts"] }) { if (!receipts.length) return <p className="py-6 text-center text-caption text-smoke">Verified answers collect here.</p>; return <ul className="divide-y divide-ash">{receipts.slice().reverse().map((receipt) => <li key={receipt.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0 flex-1 truncate text-caption">{receipt.callPrompt}</span><ReceiptChip state={receipt.state} receiptId={receipt.id} roomId={String(receipt.roomId)} /></li>)}</ul>; }

function CallList({ roomId, state, canParticipate, onAnswer, compact = false }: { roomId: string; state: import("@/lib/data").RoomLiveState; canParticipate: boolean; onAnswer: (callId: string, optionId: string) => Promise<void>; compact?: boolean }) { const calls = compact ? state.calls.slice(-1) : state.calls; if (!calls.length) return <p className="py-6 text-center text-caption text-smoke">Signed calls appear when the fixture publisher opens them.</p>; return <div className="space-y-3 py-4">{calls.map((call) => <CallCard key={String(call.call.id)} view={call} roomId={roomId} canSelect={canParticipate} attestationAvailable={state.attestationAvailable} onSelect={(optionId) => onAnswer(String(call.call.id), optionId)} className="p-4" />)}</div>; }

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="bg-parchment px-3 py-3"><p className="text-[9px] uppercase tracking-[0.08em] text-smoke">{label}</p><p className="mt-1 font-mono text-body-sm font-medium tabular">{value}</p></div>;
}

function RoomHeader({
  roomName,
  fixture,
  members,
  unreadCount,
  onInvite,
  onMembers,
  canInvite,
}: {
  roomName: string;
  fixture: import("@/lib/data").RoomLiveState["fixture"];
  members: import("@/lib/data").RoomLiveState["members"];
  unreadCount: number;
  onInvite: () => void;
  onMembers: () => void;
  canInvite: boolean;
}) {
  const match = fixture.fixture;
  const live = fixture.phase === "live";
  const homeName = match.home.shortName ?? match.home.name.slice(0, 3).toUpperCase();
  const awayName = match.away.shortName ?? match.away.name.slice(0, 3).toUpperCase();
  return (
    <header className="z-30 h-[104px] shrink-0 border-b border-ash bg-parchment/98 backdrop-blur">
      <Container className="h-full max-w-5xl px-3 sm:px-8">
        <div className="flex h-[52px] items-center gap-3 border-b border-ash/65">
          <Link href="/matches" className="grid size-8 place-items-center rounded-full hover:bg-white" aria-label="Back to fixtures"><ChevronLeft className="size-4" /></Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-3 text-smoke" />
              <h1 className="truncate font-mono text-body-sm font-medium">{roomName}</h1>
              {unreadCount ? <span className="rounded-full bg-lake-blue px-1.5 py-0.5 text-[9px] text-parchment">{unreadCount}</span> : null}
            </div>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-smoke">Encrypted Pear room</p>
          </div>
          <button type="button" onClick={onMembers} className="hidden items-center gap-2 rounded-full border border-ash px-2 py-1.5 sm:flex" aria-label={`${members.length} members`}>
            <span className="flex -space-x-1.5">
              {members.slice(0, 3).map((member) => (
                <PeerAvatar
                  key={String(member.userId)}
                  userId={member.userId}
                  displayName={member.displayName}
                  size="xs"
                  isCurrentUser={member.isCurrentUser}
                  className="border-parchment"
                />
              ))}
            </span>
            <span className="text-[10px] text-smoke">{members.length}</span>
          </button>
          <MatchCalloutToggle className="inline-flex items-center gap-1.5 rounded-full border border-ash px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-smoke hover:bg-white hover:text-off-black" />
          <AccountSettingsButton />
          <Button type="button" size="sm" className="px-3 sm:px-5" onClick={onInvite} disabled={!canInvite}><Link2 className="size-3.5" /><span className="hidden sm:inline">Invite</span></Button>
        </div>
        <div className="flex h-[51px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2 text-caption uppercase tracking-[0.08em]"><span className="truncate sm:min-w-14">{homeName}</span><strong className="text-label tabular">{fixture.score ? `${fixture.score.home}–${fixture.score.away}` : "vs"}</strong><span className="truncate text-right sm:min-w-14">{awayName}</span></div>
          <span className="inline-flex items-center gap-1.5 text-caption uppercase tracking-[0.08em] text-graphite">{live ? <span className="size-1.5 animate-pulse rounded-full bg-crimson" /> : null}{fixture.minute != null ? `${fixture.minute}'` : String(fixture.status).replaceAll("-", " ")}</span>
        </div>
      </Container>
    </header>
  );
}

function RoomTabs({ tab, unread, pollCount, onChange }: { tab: RoomTab; unread: number; pollCount: number; onChange: (tab: RoomTab) => void }) {
  const tabs: Array<{ id: RoomTab; label: string; count?: number }> = [
    { id: "chat", label: "Chat", count: unread },
    { id: "polls", label: "Polls", count: pollCount },
    { id: "details", label: "Room details" },
  ];
  return (
    <nav className="flex h-[49px] shrink-0 border-b border-ash" aria-label="Room views">
      {tabs.map((item) => (
        <button key={item.id} type="button" onClick={() => onChange(item.id)} className={cn("relative flex flex-1 items-center justify-center gap-1.5 px-2 text-caption uppercase tracking-[0.08em] text-smoke", tab === item.id && "text-off-black after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-off-black")}>
          {item.label}{item.count ? <span className="rounded-full bg-periwinkle-mist px-1.5 py-0.5 text-[9px] text-off-black">{item.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function MobileRoomTools({ calls, timeline, receipts, members, marketSays, onOpen }: { calls: number; timeline: number; receipts: number; members: number; marketSays: number; onOpen: (sheet: Exclude<MobileSheet, null>) => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-ash px-2 lg:hidden">
      <ToolButton icon={<Sparkles className="size-3.5" />} label="Pulse" count={marketSays} onClick={() => onOpen("pulse")} />
      <ToolButton icon={<LockKeyhole className="size-3.5" />} label="Calls" count={calls} onClick={() => onOpen("calls")} />
      <ToolButton icon={<ListTree className="size-3.5" />} label="Timeline" count={timeline} onClick={() => onOpen("timeline")} />
      <ToolButton icon={<ReceiptText className="size-3.5" />} label="Receipts" count={receipts} onClick={() => onOpen("receipts")} />
      <ToolButton icon={<Users className="size-3.5" />} label="Members" count={members} onClick={() => onOpen("members")} />
    </div>
  );
}

function ToolButton({ icon, label, count, onClick }: { icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] text-smoke hover:bg-white hover:text-off-black">
      {icon}
      {label}
      {count > 0 ? <span className="tabular">{count}</span> : null}
    </button>
  );
}

function PollIndex({ items, stage, onStage, canVote, onVote, fixture, onAttachMarket }: { items: Extract<RoomFeedItem, { kind: "poll" }>[]; stage: PollStage; onStage: (stage: PollStage) => void; canVote: boolean; onVote: (pollId: string, option: string) => void; fixture: import("@fulltime/shared").Fixture; onAttachMarket: (input: import("@fulltime/shared").RoomMarketReference & { pollId: string }) => Promise<void> }) {
  const answered = (item: Extract<RoomFeedItem, { kind: "poll" }>) => Boolean(item.myVote);
  const visible = items.filter((item) => stage === "completed" ? answered(item) : !answered(item));
  const activeCount = items.filter((item) => !answered(item)).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 flex border-b border-ash bg-parchment px-4 py-3 sm:px-6"><IndexButton active={stage === "active"} label="Open" count={activeCount} onClick={() => onStage("active")} /><IndexButton active={stage === "completed"} label="Answered" count={items.length - activeCount} onClick={() => onStage("completed")} /></div>
      <div className="mx-auto max-w-3xl space-y-4 px-3 py-5 sm:px-6">
        {visible.length ? visible.map((item) => (
          <div key={String(item.id)}>
            <p className="mb-1.5 text-caption text-smoke">{item.author?.displayName ?? "Room poll"}</p>
            <PollCard key={`${item.id}:${item.myVote ?? "none"}`} poll={item.poll} myVote={item.myVote} canVote={canVote} onVote={(option) => onVote(String(item.poll.id), option)} className="rounded-[18px] bg-white/40 p-5" fixture={fixture} isAuthor={Boolean(item.author?.isCurrentUser)} onAttachMarket={onAttachMarket} />
          </div>
        )) : <EmptyState title={stage === "active" ? "No open polls" : "No answered polls"} hint={stage === "active" ? "Create a poll from the chat composer." : "Polls you answer collect here."} className="rounded-[18px]" />}
      </div>
    </div>
  );
}

function IndexButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) { return <button type="button" onClick={onClick} aria-pressed={active} className={cn("border-b px-4 py-1.5 text-caption uppercase tracking-[0.08em]", active ? "border-off-black text-off-black" : "border-transparent text-smoke")}>{label} · {count}</button>; }

function RoomMobileSheets({ sheet, onClose, roomId, state, canParticipate, onAnswer }: { sheet: MobileSheet; onClose: () => void; roomId: string; state: import("@/lib/data").RoomLiveState; canParticipate: boolean; onAnswer: (callId: string, optionId: string) => Promise<void> }) {
  const match = state.fixture.fixture;
  const story = projectMatchStory({
    fixtureId: match.id,
    homeName: match.home.shortName ?? match.home.name,
    awayName: match.away.shortName ?? match.away.name,
    events: state.timeline,
    pressure: state.pressure,
    minute: state.fixture.minute,
    phase: state.fixture.phase,
  });
  const latestMarketSays = state.marketSays.slice(-3).reverse();
  return (
    <>
      <Sheet open={sheet === "pulse"} onClose={onClose} eyebrow="Match pulse" title="Story · Fan IQ · Market" className="max-h-[82dvh]">
        <div className="max-h-[62dvh] space-y-4 overflow-y-auto">
          <MatchStoryCard story={story} />
          <FanIqStrip iq={state.fanIq} receipts={state.receipts} />
          {latestMarketSays.length ? latestMarketSays.map((card) => <MarketSaysCard key={card.id} card={card} />) : (
            <p className="py-4 text-center text-caption text-smoke">Market Says appears when signed odds move materially.</p>
          )}
        </div>
      </Sheet>
      <Sheet open={sheet === "calls"} onClose={onClose} eyebrow="Signed fixture feed" title={`Calls · ${state.calls.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><CallList roomId={roomId} state={state} canParticipate={canParticipate} onAnswer={onAnswer} /></div></Sheet>
      <Sheet open={sheet === "timeline"} onClose={onClose} eyebrow="Match room" title={`Timeline · ${state.timeline.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><EventFeed events={state.timeline} /></div></Sheet>
      <Sheet open={sheet === "receipts"} onClose={onClose} eyebrow="Verified moments" title={`Receipts · ${state.receipts.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><ReceiptList receipts={state.receipts} /></div></Sheet>
      <Sheet open={sheet === "members"} onClose={onClose} eyebrow="Invite-only room" title={`Members · ${state.members.length}`} className="max-h-[82dvh]"><div className="max-h-[62dvh] overflow-y-auto"><RoomMemberList members={state.members} /></div></Sheet>
    </>
  );
}

function InviteSheet({
  open,
  onClose,
  details,
  roomId,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  details: RoomDetailsModel | null;
  roomId: string;
  onReload: () => Promise<void>;
}) {
  const { client } = useData();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const relative = details?.invite?.url ?? "";
  const absolute = typeof window === "undefined" || !relative ? relative : new URL(relative, window.location.origin).toString();

  const mutate = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await onReload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invite could not be updated.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!absolute) return;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError("Clipboard access is unavailable. Use Share instead.");
    }
  };
  const share = async () => {
    if (!absolute) return;
    // Onside/FanField edge: challenge framing, not a generic invite
    const battle = `Back your stand in my FullTime room — spoiler-safe, Fan IQ on the line. ${absolute}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: details?.room.name ?? "FullTime room",
          text: battle,
          url: absolute,
        });
      } else {
        await navigator.clipboard.writeText(battle);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("The invite could not be shared. Copy the link instead.");
    }
  };

  const active = details?.invite?.status === "active" && !details.isClosed;
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Invite-only" title="Bring your people">
      <div className="space-y-5">
        {active ? (
          <>
            <div className="mx-auto grid w-full max-w-[320px] place-items-center bg-white p-4"><QRCodeSVG value={absolute} size={288} level="L" marginSize={4} className="h-auto w-full" /></div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="primary" size="sm" onClick={() => void copy()}><Copy className="size-3.5" />{copied ? "Copied" : "Copy link"}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => void share()}><Share2 className="size-3.5" />Share</Button>
            </div>
            <p className="text-center text-caption text-smoke">{details.invite?.viewerSuccessfulJoins ?? 0} successful joins through your invite.</p>
            {(details.permissions.canRegenerateInvite || details.permissions.canRevokeInvite) ? (
              <div className="flex justify-center gap-2 border-t border-ash pt-4">
                {details.permissions.canRegenerateInvite ? <Button type="button" variant="quiet" size="sm" disabled={Boolean(busy)} onClick={() => void mutate("regenerate", () => client.regenerateInvite(roomId))}>Regenerate</Button> : null}
                {details.permissions.canRevokeInvite ? <Button type="button" variant="quiet" size="sm" disabled={Boolean(busy)} onClick={() => void mutate("revoke", () => client.revokeInvite(roomId))}>Revoke</Button> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="grid place-items-center py-8 text-center">
            <LockKeyhole className="size-6 text-smoke" />
            <p className="mt-3 text-body-sm text-smoke">{details?.isClosed ? "This room is closed." : "There is no active invite."}</p>
            {details && !details.isClosed && details.permissions.canRegenerateInvite ? <Button type="button" className="mt-5" disabled={Boolean(busy)} onClick={() => void mutate("create", () => client.createInvite(roomId))}>Create invite</Button> : null}
          </div>
        )}
        {error ? <p className="text-caption text-crimson">{error}</p> : null}
      </div>
    </Sheet>
  );
}

function RoomFrame({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col"><header className="border-b border-ash"><Container className="flex h-[72px] items-center justify-between"><Logo href="/app" /><Link href="/matches" className="text-body-sm uppercase tracking-[0.06em] text-graphite">Fixtures</Link></Container></header><main className="flex flex-1 items-center"><Container className="py-16">{children}</Container></main></div>;
}

function RoomSkeleton() {
  return <div className="flex h-dvh flex-col"><header className="h-[104px] border-b border-ash"><Container className="space-y-3 py-3"><Skeleton className="h-7 w-52" /><Skeleton className="h-10 w-full" /></Container></header><main className="min-h-0 flex-1"><Container className="h-full max-w-5xl px-0 sm:px-8"><div className="space-y-4 border-x border-ash p-5"><Skeleton className="h-10" /><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div></Container></main></div>;
}
