"use client";

/* Room media can be browser-local blob URLs in mock mode. */
/* eslint-disable @next/next/no-img-element */

import {
  Bell,
  BellRing,
  Check,
  Copy,
  Crown,
  Gauge,
  ImageIcon,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  UserMinus,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import type { FullTimeData, RoomDetailsView, RoomMemberView, RoomNotificationSettings } from "@/lib/data";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";

export function RoomDetails({
  roomId,
  details,
  client,
  onReload,
  onCalibrate,
  onOpenInvite,
  onOpenImage,
}: {
  roomId: string;
  details: RoomDetailsView | null;
  client: FullTimeData;
  onReload: () => Promise<void>;
  onCalibrate: () => void;
  onOpenInvite: () => void;
  onOpenImage: (url: string, alt: string) => void;
}) {
  const [rename, setRename] = useState("");
  const [slowMode, setSlowMode] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!details) return <DetailsSkeleton />;

  const run = async (key: string, action: () => Promise<unknown>, success: string, reload = true): Promise<boolean> => {
    setBusy(key);
    setFeedback(null);
    try {
      await action();
      if (reload) await onReload();
      setFeedback(success);
      return true;
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : "That change could not be saved.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const notificationToggle = (key: keyof RoomNotificationSettings) => {
    void run(
      `notification-${key}`,
      () => client.updateNotificationSettings(roomId, { [key]: !details.notificationSettings[key] }),
      "Notification settings updated.",
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-6">
      {feedback ? (
        <div className="flex items-center gap-2 border border-ash bg-white/55 px-4 py-3 text-body-sm" role="status">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4 text-lake-blue" />}
          {feedback}
        </div>
      ) : null}

      <section className="grid gap-px border border-ash bg-ash sm:grid-cols-3">
        <StatBlock label="Room rank" value={details.fanIq.roomRank ? `#${details.fanIq.roomRank}` : "—"} sub={`of ${details.fanIq.roomSize}`} />
        <StatBlock label="Fan IQ" value={details.fanIq.fanIq} sub="Prediction performance" />
        <StatBlock label="Influence" value={details.influence.score} sub={`Level ${details.influence.level}`} />
      </section>

      <section className="border border-ash bg-white/35 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-caption uppercase tracking-[0.1em] text-smoke">Invite-only room</p>
            <h2 className="mt-1 text-heading-sm">{details.room.name}</h2>
            <p className="mt-2 text-body-sm text-smoke">
              {details.fixture.competition} · {details.fixture.home.name} vs {details.fixture.away.name}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onOpenInvite} disabled={details.isClosed || !details.permissions.canInvite}>
            <Link2 className="size-3.5" /> Invite
          </Button>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-ash pt-5 text-body-sm sm:grid-cols-3">
          <div>
            <dt className="text-caption uppercase tracking-[0.08em] text-smoke">Created</dt>
            <dd className="mt-1">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(Number(details.room.createdAt)))}</dd>
          </div>
          <div>
            <dt className="text-caption uppercase tracking-[0.08em] text-smoke">Privacy</dt>
            <dd className="mt-1 inline-flex items-center gap-1.5"><LockKeyhole className="size-3.5" /> Invite only</dd>
          </div>
          <div>
            <dt className="text-caption uppercase tracking-[0.08em] text-smoke">Slow mode</dt>
            <dd className="mt-1">{details.slowModeSeconds ? `${details.slowModeSeconds} seconds` : "Off"}</dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="border border-ash bg-white/35 p-5">
          <SectionTitle icon={<Gauge className="size-4" />} title="MatchSync" />
          <p className="mt-3 text-body-sm text-graphite">
            Calibrate FullTime to your stream. TxLINE feed time remains authoritative; your delay changes when match-anchored items appear for you.
          </p>
          <button type="button" onClick={onCalibrate} className="mt-4 text-caption uppercase tracking-[0.08em] text-lake-blue hover:underline">
            Calibrate stream delay →
          </button>
        </div>

        <div className="border border-ash bg-white/35 p-5">
          <SectionTitle icon={<Crown className="size-4" />} title="Your influence" />
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-heading-sm tabular">{details.influence.successfulJoins}</p>
              <p className="text-caption text-smoke">unique successful joins</p>
            </div>
            <p className="text-right text-caption text-smoke">
              {details.influence.nextLevelAt == null ? "Top level" : `${details.influence.nextLevelAt - details.influence.successfulJoins} to next level`}
            </p>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ash/50" aria-label={`${Math.round(details.influence.progress * 100)}% to next Influence level`}>
            <span className="block h-full bg-lake-blue" style={{ width: `${Math.round(details.influence.progress * 100)}%` }} />
          </div>
          <p className="mt-3 text-[11px] text-smoke">Influence counts unique joins—not link copies or repeat invites. Fan IQ remains prediction-only.</p>
        </div>
      </section>

      <section className="border border-ash bg-white/35 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <SectionTitle icon={<Users className="size-4" />} title={`Members · ${details.members.length}`} />
          <span className="text-caption text-smoke">{details.members.filter((member) => member.isOnline).length} online</span>
        </div>
        <RoomMemberList
          members={details.members}
          canModerate={details.permissions.canModerateMembers}
          busy={busy}
          onRemove={(member) => {
            if (!window.confirm(`Remove ${member.displayName} from the room?`)) return;
            void run(`remove-${member.userId}`, () => client.removeMember(roomId, String(member.userId)), `${member.displayName} was removed.`);
          }}
          onToggleModerator={(member) => {
            const role = member.role === "moderator" ? "member" : "moderator";
            void run(`role-${member.userId}`, () => client.setMemberRole(roomId, String(member.userId), role), `${member.displayName} is now a ${role}.`);
          }}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="border border-ash bg-white/35 p-5">
          <SectionTitle icon={<BellRing className="size-4" />} title="Notifications" />
          <div className="mt-3 divide-y divide-ash">
            {(Object.keys(details.notificationSettings) as Array<keyof RoomNotificationSettings>).map((key) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-4 py-3 text-body-sm capitalize">
                <span className="inline-flex items-center gap-2"><Bell className="size-3.5 text-smoke" /> {key.replace(/([A-Z])/g, " $1")}</span>
                <input
                  type="checkbox"
                  checked={details.notificationSettings[key]}
                  disabled={busy === `notification-${key}`}
                  onChange={() => notificationToggle(key)}
                  className="size-4 accent-lake-blue"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="border border-ash bg-white/35 p-5">
          <SectionTitle icon={<ImageIcon className="size-4" />} title={`Media · ${details.media.length}`} />
          {details.media.length ? (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {details.media.slice(0, 9).map((attachment) => (
                <button key={attachment.id} type="button" onClick={() => onOpenImage(attachment.url, attachment.name)} className="aspect-square overflow-hidden bg-ash/25">
                  <img src={attachment.url} alt={attachment.name} className="size-full object-cover transition-transform hover:scale-105" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-body-sm text-smoke">Images shared in Chat collect here.</p>
          )}
        </div>
      </section>

      {!details.isClosed && (details.permissions.canRename || details.permissions.canSetSlowMode || details.permissions.canCloseRoom) ? (
        <section className="border border-off-black bg-white/35 p-5 sm:p-6">
          <SectionTitle icon={<SlidersHorizontal className="size-4" />} title="Creator controls" />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {details.permissions.canRename ? (
              <label className="block">
                <span className="text-caption text-smoke">Rename room</span>
                <div className="mt-1 flex gap-2">
                  <input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={80} placeholder={details.room.name} className="min-w-0 flex-1 border border-ash bg-parchment px-3 py-2 text-body-sm outline-none focus:border-off-black" />
                  <button type="button" disabled={!rename.trim() || busy === "rename"} onClick={() => void run("rename", () => client.renameRoom(roomId, rename.trim()), "Room renamed.").then((ok) => { if (ok) setRename(""); })} className="border border-off-black px-3 text-caption uppercase disabled:opacity-35">Save</button>
                </div>
              </label>
            ) : null}
            {details.permissions.canSetSlowMode ? (
              <label className="block">
                <span className="text-caption text-smoke">Slow mode</span>
                <div className="mt-1 flex gap-2">
                  <select value={slowMode ?? String(details.slowModeSeconds)} onChange={(event) => setSlowMode(event.target.value)} className="min-w-0 flex-1 border border-ash bg-parchment px-3 py-2 text-body-sm outline-none">
                    <option value="0">Off</option><option value="5">5 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option>
                  </select>
                  <button type="button" disabled={busy === "slow"} onClick={() => void run("slow", () => client.setSlowMode(roomId, Number(slowMode ?? details.slowModeSeconds)), "Slow mode updated.").then((ok) => { if (ok) setSlowMode(null); })} className="border border-off-black px-3 text-caption uppercase disabled:opacity-35">Apply</button>
                </div>
              </label>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-ash pt-5">
            {details.permissions.canRegenerateInvite ? <Button type="button" variant="ghost" size="sm" disabled={busy === "regenerate"} onClick={() => void run("regenerate", () => client.regenerateInvite(roomId), "A new invite link is active.")}><RefreshCw className="size-3.5" /> Regenerate invite</Button> : null}
            {details.permissions.canRevokeInvite ? <Button type="button" variant="ghost" size="sm" disabled={!details.invite || busy === "revoke"} onClick={() => { if (window.confirm("Revoke the active invite? Existing members will keep access.")) void run("revoke", () => client.revokeInvite(roomId), "Invite revoked."); }}>Revoke invite</Button> : null}
            {details.permissions.canCloseRoom ? <Button type="button" variant="secondary" size="sm" disabled={details.isClosed || busy === "close"} onClick={() => { if (window.confirm("Close this room? Members will no longer be able to post.")) void run("close", () => client.closeRoom(roomId), "Room closed."); }}><LockKeyhole className="size-3.5" /> Close room</Button> : null}
          </div>
        </section>
      ) : null}

      <section className="border border-ash p-5 sm:p-6">
        <SectionTitle icon={<ShieldAlert className="size-4" />} title="Safety & access" />
        <label className="mt-4 block">
          <span className="text-caption text-smoke">Report this room</span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <input value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="Tell us what happened" className="min-w-0 flex-1 border border-ash bg-white/40 px-3 py-2 text-body-sm outline-none focus:border-off-black" />
            <Button type="button" variant="ghost" size="sm" disabled={!reportReason.trim() || busy === "report"} onClick={() => void run("report", () => client.reportRoom(roomId, reportReason.trim()), "Report received. Thank you.", false).then((ok) => { if (ok) setReportReason(""); })}>Report</Button>
          </div>
        </label>
        {details.members.find((member) => member.isCurrentUser)?.role === "creator" && !details.isClosed ? (
          <p className="mt-5 text-caption text-smoke">Creators must close the room before leaving it.</p>
        ) : (
          <button type="button" onClick={() => { if (window.confirm("Leave this room? You will need a valid invite to return.")) void run("leave", () => client.leaveRoom(roomId), "You left the room.", false).then((ok) => { if (ok) window.location.href = "/matches"; }); }} className="mt-5 inline-flex items-center gap-2 text-caption uppercase tracking-[0.08em] text-crimson">
            <LogOut className="size-3.5" /> Leave room
          </button>
        )}
      </section>
    </div>
  );
}

export function RoomMemberList({
  members,
  canModerate = false,
  busy,
  onRemove,
  onToggleModerator,
}: {
  members: RoomMemberView[];
  canModerate?: boolean;
  busy?: string | null;
  onRemove?: (member: RoomMemberView) => void;
  onToggleModerator?: (member: RoomMemberView) => void;
}) {
  return (
    <ul className="mt-3 divide-y divide-ash">
      {members.map((member) => (
        <li key={String(member.userId)} className="flex items-center gap-3 py-3">
          <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-ash bg-parchment text-[10px] font-medium">
            {member.displayName.slice(0, 2).toUpperCase()}
            <span className={cn("absolute bottom-0 right-0 size-2 rounded-full border border-parchment", member.isOnline ? "bg-mint" : "bg-ash")} aria-label={member.isOnline ? "Online" : "Offline"} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-medium">{member.displayName} {member.isCurrentUser ? <span className="font-normal text-smoke">(you)</span> : null}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-smoke">{member.role} · {member.successfulInvites} joins</p>
          </div>
          {member.role === "creator" ? <Crown className="size-4 text-gold" aria-label="Creator" /> : member.role === "moderator" ? <Shield className="size-4 text-lake-blue" aria-label="Moderator" /> : null}
          {canModerate && !member.isCurrentUser && member.role !== "creator" ? (
            <div className="flex items-center gap-1">
              <button type="button" disabled={busy === `role-${member.userId}`} onClick={() => onToggleModerator?.(member)} className="grid size-8 place-items-center text-smoke hover:bg-parchment hover:text-off-black" aria-label={member.role === "moderator" ? `Remove ${member.displayName} as moderator` : `Make ${member.displayName} a moderator`}>
                <Shield className="size-3.5" />
              </button>
              <button type="button" disabled={busy === `remove-${member.userId}`} onClick={() => onRemove?.(member)} className="grid size-8 place-items-center text-smoke hover:bg-coral/15 hover:text-crimson" aria-label={`Remove ${member.displayName}`}>
                <UserMinus className="size-3.5" />
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <h2 className="flex items-center gap-2 text-label">{icon}{title}</h2>;
}

function StatBlock({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="bg-parchment p-5">
      <p className="text-caption uppercase tracking-[0.1em] text-smoke">{label}</p>
      <p className="mt-2 text-heading-sm font-medium tabular">{value}</p>
      <p className="mt-1 text-[11px] text-smoke">{sub}</p>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-52 w-full" />
      <div className="grid gap-5 sm:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function CompactInviteCard({ details, onOpen }: { details: RoomDetailsView; onOpen: () => void }) {
  const relative = details.invite?.url ?? "";
  const url = typeof window === "undefined" || !relative ? relative : new URL(relative, window.location.origin).toString();
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 border border-ash bg-white/35 p-3 text-left hover:border-off-black">
      <span className="grid size-12 shrink-0 place-items-center bg-white">
        {url ? <QRCodeSVG value={url} size={38} level="L" /> : <LockKeyhole className="size-4 text-smoke" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-medium">Invite your people</span>
        <span className="mt-0.5 block truncate text-[10px] text-smoke">
          {details.invite ? `${details.invite.viewerSuccessfulJoins} friends joined through you` : "Create a new invite link"}
        </span>
      </span>
      <Copy className="size-3.5 text-smoke" />
    </button>
  );
}
