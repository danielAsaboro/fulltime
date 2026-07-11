"use client";

import {
  Check,
  Bell,
  Crown,
  Flag,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  UserMinus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  FullTimeData,
  ModerationReportReason,
  ModerationReportView,
  RoomDetailsView,
  RoomMemberView,
  RoomNotificationSettings,
} from "@/lib/data";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";

export function RoomDetails({
  roomId,
  details,
  client,
  onReload,
  onOpenInvite,
}: {
  roomId: string;
  details: RoomDetailsView | null;
  client: FullTimeData;
  onReload: () => Promise<void>;
  onOpenInvite: () => void;
}) {
  const [rename, setRename] = useState("");
  const [slowMode, setSlowMode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notificationState, setNotificationState] = useState<{
    roomId: string;
    settings: RoomNotificationSettings | null;
    error: string | null;
  } | null>(null);
  const notificationSettings = notificationState?.roomId === roomId ? notificationState.settings : null;
  const notificationError = notificationState?.roomId === roomId ? notificationState.error : null;

  useEffect(() => {
    let alive = true;
    void client.getNotificationSettings(roomId).then((settings) => {
      if (alive) setNotificationState({ roomId, settings, error: null });
    }).catch((reason: unknown) => {
      if (alive) setNotificationState({
        roomId,
        settings: null,
        error: reason instanceof Error ? reason.message : "Message notification settings are unavailable.",
      });
    });
    return () => { alive = false; };
  }, [client, roomId]);

  if (!details) return <DetailsSkeleton />;

  const run = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key);
    setFeedback(null);
    try {
      await action();
      await onReload();
      setFeedback(success);
      return true;
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "That change could not be saved.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const currentMember = details.members.find((member) => member.isCurrentUser);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-6">
      {feedback ? (
        <div className="flex items-center gap-2 border border-ash bg-white/55 px-4 py-3 text-body-sm" role="status">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4 text-lake-blue" />}
          {feedback}
        </div>
      ) : null}

      <section className="border border-ash bg-white/35 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 text-caption uppercase tracking-[0.1em] text-smoke">
              <LockKeyhole className="size-3.5" /> Encrypted invite-only room
            </p>
            <h2 className="mt-2 text-heading-sm">{details.room.name}</h2>
            <p className="mt-2 text-body-sm text-smoke">
              {details.fixture.competition} · {details.fixture.home.name} vs {details.fixture.away.name}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenInvite}
            disabled={details.isClosed || !(details.permissions.canInvite || details.permissions.canRegenerateInvite)}
          >
            <Link2 className="size-3.5" /> Invite
          </Button>
        </div>
        <dl className="mt-6 grid gap-px border border-ash bg-ash sm:grid-cols-3">
          <StatBlock label="Members" value={details.members.length} />
          <StatBlock label="Slow mode" value={details.slowModeSeconds ? `${details.slowModeSeconds}s` : "Off"} />
          <StatBlock label="Invite joins" value={details.influence.successfulJoins} />
        </dl>
        {details.isClosed ? <p className="mt-4 bg-gold/25 px-3 py-2 text-caption">This room is closed and read-only.</p> : null}
      </section>

      {details.invite?.status === "active" && !details.isClosed ? (
        <CompactInviteCard details={details} onOpen={onOpenInvite} />
      ) : null}

      <section className="border border-ash bg-white/35">
        <div className="flex items-center gap-2 border-b border-ash px-5 py-4">
          <Users className="size-4 text-smoke" />
          <h3 className="text-caption uppercase tracking-[0.09em]">Members · {details.members.length}</h3>
        </div>
        <RoomMemberList
          members={details.members}
          canModerate={details.permissions.canModerateMembers}
          busy={busy}
          onToggleModerator={(member) => {
            const role = member.role === "moderator" ? "member" : "moderator";
            void run(`role-${member.userId}`, () => client.setMemberRole(roomId, String(member.userId), role), `${member.displayName}'s role was updated.`);
          }}
          onRemove={(member) => {
            void run(`remove-${member.userId}`, () => client.removeMember(roomId, String(member.userId)), `${member.displayName} was removed.`);
          }}
        />
      </section>

      {(details.permissions.canRename || details.permissions.canSetSlowMode || details.permissions.canCloseRoom) ? (
        <details className="group border border-ash bg-white/35">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 sm:px-6">
            <SlidersHorizontal className="size-4 text-smoke" />
            <h3 className="flex-1 text-caption uppercase tracking-[0.09em]">Creator controls</h3><span className="text-smoke group-open:rotate-45">+</span>
          </summary><div className="space-y-5 border-t border-ash p-5 sm:p-6">
          {details.permissions.canRename ? (
            <div>
              <label htmlFor="room-rename" className="text-caption text-smoke">Room name</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="room-rename"
                  value={rename}
                  onChange={(event) => setRename(event.target.value)}
                  maxLength={48}
                  placeholder={details.room.name}
                  className="min-w-0 flex-1 border border-ash bg-parchment px-3 py-2 text-body-sm outline-none focus:border-off-black"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!rename.trim() || busy === "rename"}
                  onClick={() => void run("rename", () => client.renameRoom(roomId, rename.trim()), "Room renamed.").then((ok) => { if (ok) setRename(""); })}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : null}
          {details.permissions.canSetSlowMode ? (
            <div>
              <label htmlFor="room-slow-mode" className="text-caption text-smoke">Slow mode, 0–60 seconds</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="room-slow-mode"
                  type="number"
                  min={0}
                  max={60}
                  value={slowMode ?? details.slowModeSeconds}
                  onChange={(event) => setSlowMode(event.target.value)}
                  className="min-w-0 flex-1 border border-ash bg-parchment px-3 py-2 text-body-sm outline-none focus:border-off-black"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy === "slow"}
                  onClick={() => void run("slow", () => client.setSlowMode(roomId, Number(slowMode ?? details.slowModeSeconds)), "Slow mode updated.").then((ok) => { if (ok) setSlowMode(null); })}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : null}
          {details.permissions.canCloseRoom ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy === "close"} onClick={() => void run("close", () => client.closeRoom(roomId), "Room closed.")}>Close room</Button>
          ) : null}
          </div></details>
      ) : null}

      {currentMember ? (
        <details className="group border border-ash bg-white/35">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 sm:px-6">
            <Bell className="size-4 text-smoke" />
            <h3 className="flex-1 text-caption uppercase tracking-[0.09em]">Notifications</h3><span className="text-smoke group-open:rotate-45">+</span>
          </summary><div className="border-t border-ash p-5 sm:p-6">
          <p className="mt-2 text-body-sm text-smoke">Show a native desktop alert when another room member sends a new message.</p>
          {notificationError ? <p className="mt-3 text-caption text-crimson">{notificationError}</p> : null}
          {notificationSettings ? (
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 border border-ash bg-parchment px-3 py-3 text-body-sm">
              <span>Message alerts</span>
              <input
                type="checkbox"
                checked={notificationSettings.messages}
                disabled={busy === "notifications-messages"}
                onChange={(event) => {
                  const messages = event.target.checked;
                  setBusy("notifications-messages");
                  setNotificationState({ roomId, settings: notificationSettings, error: null });
                  void client.updateNotificationSettings(roomId, { messages }).then((next) => {
                    setNotificationState({ roomId, settings: next, error: null });
                  }).catch((reason: unknown) => {
                    setNotificationState({
                      roomId,
                      settings: notificationSettings,
                      error: reason instanceof Error ? reason.message : "Message notification settings could not be saved.",
                    });
                  }).finally(() => setBusy(null));
                }}
                className="size-4 accent-lake-blue"
              />
            </label>
          ) : !notificationError ? <p className="mt-3 text-caption text-smoke">Loading notification settings…</p> : null}
          </div></details>
      ) : null}

      {currentMember ? <ReportMemberForm roomId={roomId} members={details.members} client={client} /> : null}

      {currentMember?.role === "creator" || currentMember?.role === "moderator" ? (
        <ModerationInbox roomId={roomId} members={details.members} client={client} />
      ) : null}

      {currentMember ? (
        <details className="group border border-crimson/25 bg-white/35">
          <summary className="flex cursor-pointer list-none items-center px-5 py-4 text-caption uppercase tracking-[0.09em] text-crimson sm:px-6"><span className="flex-1">Leave room</span><span className="group-open:rotate-45">+</span></summary><div className="border-t border-crimson/20 p-5 sm:p-6">
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={busy === "leave"}
            onClick={() => void run("leave", () => client.leaveRoom(roomId), "You left the room.").then((ok) => {
              if (ok) window.location.assign("/matches");
            })}
          >
            <LogOut className="size-3.5" /> Leave room
          </Button>
          </div></details>
      ) : null}
    </div>
  );
}

const REPORT_REASONS: readonly ModerationReportReason[] = [
  "harassment",
  "hate",
  "misinformation",
  "sexual-content",
  "spam",
  "threats",
  "other",
];

function ReportMemberForm({ roomId, members, client }: { roomId: string; members: RoomMemberView[]; client: FullTimeData }) {
  const candidates = members.filter((member) => !member.isCurrentUser);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState<ModerationReportReason>("harassment");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!candidates.length) return null;

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await client.reportRoomTarget(roomId, { kind: "member", id: target }, reason, note);
      setTarget("");
      setReason("harassment");
      setNote("");
      setFeedback("Encrypted report sent to this room’s creator and moderators.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The encrypted report could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group border border-ash bg-white/35"><summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 sm:px-6"><Flag className="size-4 text-smoke" /><h3 className="flex-1 text-caption uppercase tracking-[0.09em]">Safety and reporting</h3><span className="text-smoke group-open:rotate-45">+</span></summary><div className="border-t border-ash p-5 sm:p-6">
      <p className="mt-2 text-body-sm text-smoke">The report is encrypted for the current creator and moderators. It is not posted to chat.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-caption text-smoke">Member
          <select value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1 w-full border border-ash bg-parchment px-3 py-2 text-body-sm text-off-black">
            <option value="">Choose a member</option>
            {candidates.map((member) => <option key={String(member.userId)} value={String(member.userId)}>{member.displayName}</option>)}
          </select>
        </label>
        <label className="text-caption text-smoke">Reason
          <select value={reason} onChange={(event) => setReason(event.target.value as ModerationReportReason)} className="mt-1 w-full border border-ash bg-parchment px-3 py-2 text-body-sm text-off-black">
            {REPORT_REASONS.map((value) => <option key={value} value={value}>{value.replace(/-/g, " ")}</option>)}
          </select>
        </label>
      </div>
      <label className="mt-3 block text-caption text-smoke">Optional note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} className="mt-1 w-full resize-y border border-ash bg-parchment px-3 py-2 text-body-sm text-off-black outline-none focus:border-off-black" />
      </label>
      <div className="mt-3 flex items-center justify-between gap-3">
        {feedback ? <p className={cn("text-caption", feedback.startsWith("Encrypted") ? "text-lake-blue" : "text-crimson")}>{feedback}</p> : <span />}
        <Button type="button" variant="ghost" size="sm" disabled={!target || busy} onClick={() => void submit()}>{busy ? "Encrypting…" : "Send report"}</Button>
      </div>
    </div></details>
  );
}

function ModerationInbox({ roomId, members, client }: { roomId: string; members: RoomMemberView[]; client: FullTimeData }) {
  const [reports, setReports] = useState<ModerationReportView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const memberNames = new Map(members.map((member) => [String(member.userId), member.displayName]));
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await client.listModerationReports(roomId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Moderation reports could not be opened.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let alive = true;
    void client.listModerationReports(roomId).then((next) => {
      if (!alive) return;
      setReports(next);
      setError(null);
    }).catch((reason: unknown) => {
      if (!alive) return;
      setError(reason instanceof Error ? reason.message : "Moderation reports could not be opened.");
    });
    return () => { alive = false; };
  }, [roomId, client]);
  return (
    <details className="group border border-ash bg-white/35"><summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 sm:px-6"><Shield className="size-4 text-lake-blue" /><h3 className="flex-1 text-caption uppercase tracking-[0.09em]">Moderation inbox</h3><span className="text-smoke group-open:rotate-45">+</span></summary><div className="border-t border-ash p-5 sm:p-6"><div className="flex justify-end"><Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>{loading ? "Opening…" : "Refresh"}</Button></div>
      {error ? <p className="mt-3 text-caption text-crimson">{error}</p> : null}
      {reports ? reports.length ? <ul className="mt-4 divide-y divide-ash border-y border-ash">{reports.map((report) => <li key={report.reportId} className="py-3 text-body-sm"><p><strong>{memberNames.get(String(report.reporterId)) ?? "Former member"}</strong> reported {memberNames.get(report.target.id) ?? report.target.id} for {report.reason.replace(/-/g, " ")}.</p>{report.note ? <p className="mt-1 whitespace-pre-wrap text-smoke">{report.note}</p> : null}<p className="mt-1 text-[10px] text-smoke">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(report.createdAt)))}</p></li>)}</ul> : <p className="mt-3 text-body-sm text-smoke">No reports addressed to your current moderator key.</p> : <p className="mt-3 text-body-sm text-smoke">Opening encrypted reports…</p>}
    </div></details>
  );
}

export function CompactInviteCard({ details, onOpen }: { details: RoomDetailsView; onOpen: () => void }) {
  return (
    <section className="border border-lake-blue/25 bg-periwinkle-mist/35 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-caption uppercase tracking-[0.09em] text-smoke">Active invite</p>
          <p className="mt-1 text-body-sm">{details.invite?.viewerSuccessfulJoins ?? 0} people joined through your invite.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onOpen}><Link2 className="size-3.5" /> Share</Button>
      </div>
    </section>
  );
}

export function RoomMemberList({
  members,
  canModerate = false,
  busy = null,
  onToggleModerator,
  onRemove,
}: {
  members: RoomMemberView[];
  canModerate?: boolean;
  busy?: string | null;
  onToggleModerator?: (member: RoomMemberView) => void;
  onRemove?: (member: RoomMemberView) => void;
}) {
  return (
    <ul className="divide-y divide-ash px-5">
      {members.map((member) => (
        <li key={String(member.userId)} className="flex items-center gap-3 py-3">
          <span className={cn("size-2 rounded-full", member.isOnline ? "bg-mint" : "bg-ash")} aria-label={member.isOnline ? "Online" : "Offline"} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-body-sm">
              <span className="truncate">{member.displayName}</span>
              {member.isCurrentUser ? <span className="text-[10px] text-smoke">You</span> : null}
            </span>
            <span className="mt-0.5 block text-[10px] uppercase tracking-[0.06em] text-smoke">{member.role}</span>
          </span>
          {member.role === "creator" ? <Crown className="size-4 text-gold" aria-label="Creator" /> : member.role === "moderator" ? <Shield className="size-4 text-lake-blue" aria-label="Moderator" /> : null}
          {canModerate && !member.isCurrentUser && member.role !== "creator" ? (
            <div className="flex gap-1">
              <button type="button" disabled={busy === `role-${member.userId}`} onClick={() => onToggleModerator?.(member)} className="grid size-8 place-items-center text-smoke hover:bg-parchment" aria-label={member.role === "moderator" ? `Remove ${member.displayName} as moderator` : `Make ${member.displayName} a moderator`}>
                <RefreshCw className="size-3.5" />
              </button>
              <button type="button" disabled={busy === `remove-${member.userId}`} onClick={() => onRemove?.(member)} className="grid size-8 place-items-center text-smoke hover:bg-coral/10" aria-label={`Remove ${member.displayName}`}>
                <UserMinus className="size-3.5" />
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StatBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="bg-parchment px-4 py-4"><dt className="text-caption uppercase tracking-[0.08em] text-smoke">{label}</dt><dd className="mt-1 text-subheading tabular">{value}</dd></div>;
}

function DetailsSkeleton() {
  return <div className="space-y-4 p-5"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
}
