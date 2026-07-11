"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  LockKeyhole,
  QrCode,
  RotateCcw,
  Share2,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import {
  useData,
  useFixtures,
  type FixtureCard as FixtureCardModel,
  type RoomDetailsView,
  type RoomPhase,
} from "@/lib/data";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { Flag } from "@/components/ui/flag";
import { Tag } from "@/components/ui/tag";
import styles from "./matches-index.module.css";

const FILTERS: { value: RoomPhase | "all"; label: string }[] = [
  { value: "all", label: "All fixtures" },
  { value: "live", label: "Live" },
  { value: "upcoming", label: "Upcoming" },
  { value: "finished", label: "Full-time" },
];

function kickoffLabel(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(ms);
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

export function MatchesIndex({ initialFixtureId }: { initialFixtureId?: string }) {
  const fixtures = useFixtures("all");
  const { client, session, signIn } = useData();
  const [filter, setFilter] = useState<RoomPhase | "all">("all");
  const [selectedId, setSelectedId] = useState(initialFixtureId ?? "");
  const [roomName, setRoomName] = useState("");
  const [roomNameTouched, setRoomNameTouched] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ details: RoomDetailsView; shareUrl: string } | null>(null);
  const [transitionDirection, setTransitionDirection] = useState<"forward" | "back">("forward");
  const setupHeadingRef = useRef<HTMLHeadingElement>(null);

  const displayName = nameTouched ? displayNameDraft : (session?.displayName ?? displayNameDraft);

  const selected = fixtures.data?.find((card) => String(card.fixture.id) === selectedId) ?? null;
  const selectedFixtureId = selected ? String(selected.fixture.id) : null;
  const roomNameValue = roomNameTouched
    ? roomName
    : selected
      ? `${selected.fixture.home.name} × ${selected.fixture.away.name}`
      : "";
  const visible = useMemo(
    () => fixtures.data?.filter((card) => filter === "all" || card.phase === filter) ?? [],
    [filter, fixtures.data],
  );

  const selectFixture = (card: FixtureCardModel) => {
    setTransitionDirection("forward");
    setSelectedId(String(card.fixture.id));
    setError(null);
  };

  useEffect(() => {
    if (!selectedFixtureId) return;
    setupHeadingRef.current?.focus();
  }, [selectedFixtureId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !roomNameValue.trim() || !displayName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(displayName.trim());
      const details = await client.createRoom({
        fixtureId: String(selected.fixture.id),
        roomName: roomNameValue.trim(),
        displayName: displayName.trim(),
      });
      if (!details.invite) throw new Error("The room was created, but its invite could not be generated.");
      setCreated({ details, shareUrl: absoluteUrl(details.invite.url) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The room could not be created.");
    } finally {
      setBusy(false);
    }
  };

  if (fixtures.status === "loading") return <CreationSkeleton />;
  if (fixtures.status === "error") return <ErrorState hint={fixtures.error ?? undefined} onRetry={fixtures.reload} />;
  if (fixtures.status === "empty" || !fixtures.data) {
    return (
      <EmptyState
        title="No fixtures yet"
        hint="The public schedule is still loading. Once fixtures arrive, you can create a private room for any match."
      />
    );
  }

  if (created?.details.invite) {
    return (
      <div className={styles.slideForward}>
        <InviteReady
          details={created.details}
          shareUrl={created.shareUrl}
          onReset={() => {
            setTransitionDirection("back");
            setCreated(null);
            setRoomName("");
            setRoomNameTouched(false);
            setSelectedId("");
          }}
        />
      </div>
    );
  }

  if (selected) {
    const { fixture, phase, minute, score } = selected;

    return (
      <section
        className={cn("mx-auto max-w-3xl", styles.slideForward)}
        aria-labelledby="room-setup-title"
      >
        <div className="overflow-hidden rounded-[24px] border border-ash bg-parchment">
          <div className="border-b border-ash px-5 py-5 sm:px-8 sm:py-7">
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setTransitionDirection("back");
                  setSelectedId("");
                  setError(null);
                }}
                className="-ml-2 inline-flex min-h-11 items-center gap-2 px-2 font-mono text-caption uppercase tracking-[0.08em] text-graphite transition-colors hover:text-off-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
                Change fixture
              </button>
              <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Step 2 of 2</p>
            </div>
            <h2
              ref={setupHeadingRef}
              id="room-setup-title"
              tabIndex={-1}
              className="mt-5 text-heading-sm text-off-black outline-none"
            >
              Make it your room.
            </h2>
            <p className="mt-2 max-w-xl font-mono text-body-sm text-graphite">
              Add the two details your guests will see. You will get the private invite next.
            </p>
          </div>

          <div className="grid md:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
            <div className="border-b border-ash bg-periwinkle-mist/50 p-5 sm:p-8 md:border-b-0 md:border-r">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Your fixture</p>
                {phase === "live" ? (
                  <Tag tone="live" dot="live">{minute == null ? "Live" : `${minute}'`}</Tag>
                ) : phase === "finished" ? (
                  <Tag tone="muted">Full-time</Tag>
                ) : (
                  <Tag>Upcoming</Tag>
                )}
              </div>

              <div className="mt-7 space-y-4">
                <FixtureTeam
                  name={fixture.home.name}
                  shortName={fixture.home.shortName}
                  country={fixture.home.country}
                  score={score?.home}
                />
                <FixtureTeam
                  name={fixture.away.name}
                  shortName={fixture.away.shortName}
                  country={fixture.away.country}
                  score={score?.away}
                />
              </div>

              <div className="mt-7 border-t border-ash/80 pt-4 font-mono text-caption text-smoke">
                <p className="uppercase tracking-[0.08em] text-graphite">{fixture.competition}</p>
                <p className="mt-1">{kickoffLabel(Number(fixture.kickoff))}</p>
              </div>
            </div>

            <form className="space-y-5 p-5 sm:p-8" onSubmit={submit}>
              <TextField
                id="room-name"
                label="Room name"
                placeholder="e.g. The Away End"
                value={roomNameValue}
                maxLength={48}
                autoComplete="off"
                hint={`${roomNameValue.length}/48`}
                onChange={(event) => {
                  setRoomNameTouched(true);
                  setRoomName(event.target.value);
                }}
              />
              <TextField
                id="creator-display-name"
                label="Your display name"
                placeholder="e.g. Amina"
                value={displayName}
                maxLength={24}
                autoComplete="nickname"
                onChange={(event) => {
                  setNameTouched(true);
                  setDisplayNameDraft(event.target.value);
                }}
              />

              {error ? <p className="font-mono text-body-sm text-crimson" role="alert">{error}</p> : null}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                disabled={!roomNameValue.trim() || !displayName.trim() || busy}
              >
                {busy ? "Creating room…" : "Create room"}
                {busy ? null : <ArrowRight size={16} strokeWidth={1.8} aria-hidden />}
              </Button>
              <p className="flex items-start gap-2 font-mono text-caption text-smoke">
                <LockKeyhole size={14} className="mt-px shrink-0" strokeWidth={1.8} aria-hidden />
                Private by default. Only people with your invite can join.
              </p>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className={cn("mx-auto min-w-0 max-w-5xl", transitionDirection === "back" && styles.slideBack)}>
      <section aria-labelledby="fixture-picker-title">
        <div className="flex flex-col gap-4 border-b border-ash pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-caption uppercase tracking-[0.12em] text-smoke">Step 1 of 2</p>
            <h2 id="fixture-picker-title" className="mt-2 text-heading-sm text-off-black">Pick a fixture</h2>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto pb-1" aria-label="Filter fixtures">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={cn(
                  "shrink-0 rounded-pill border px-3 py-2 font-mono text-caption uppercase tracking-[0.06em] transition-colors",
                  filter === item.value
                    ? "border-off-black bg-off-black text-parchment"
                    : "border-ash text-graphite hover:border-off-black",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-12 text-center font-mono text-body-sm text-smoke">No fixtures in this view.</p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {visible.map((card) => (
              <FixtureChoice
                key={String(card.fixture.id)}
                card={card}
                selected={selectedId === String(card.fixture.id)}
                onSelect={() => selectFixture(card)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FixtureChoice({
  card,
  selected,
  onSelect,
}: {
  card: FixtureCardModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const { fixture, phase, minute, score } = card;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group relative w-full rounded-lg border bg-parchment p-5 text-left transition-colors",
        selected ? "border-lake-blue ring-1 ring-lake-blue" : "border-ash hover:border-off-black",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {phase === "live" ? (
          <Tag tone="live" dot="live">{minute == null ? "Live" : `${minute}'`}</Tag>
        ) : phase === "finished" ? (
          <Tag tone="muted">Full-time</Tag>
        ) : (
          <Tag>{kickoffLabel(Number(fixture.kickoff))}</Tag>
        )}
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full border transition-colors",
            selected ? "border-lake-blue bg-lake-blue text-parchment" : "border-ash text-transparent",
          )}
          aria-hidden
        >
          <Check size={14} strokeWidth={2} />
        </span>
      </div>

      <div className="mt-5 space-y-3">
        <FixtureTeam
          name={fixture.home.name}
          shortName={fixture.home.shortName}
          country={fixture.home.country}
          score={score?.home}
        />
        <FixtureTeam
          name={fixture.away.name}
          shortName={fixture.away.shortName}
          country={fixture.away.country}
          score={score?.away}
        />
      </div>
      <p className="mt-5 border-t border-ash pt-3 font-mono text-caption uppercase tracking-[0.08em] text-smoke">
        {fixture.competition}
      </p>
    </button>
  );
}

function FixtureTeam({
  name,
  shortName,
  country,
  score,
}: {
  name: string;
  shortName?: string;
  country?: string;
  score?: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 items-center gap-2.5">
        <Flag code={country} size={20} />
        <span className="truncate font-mono text-body-sm font-medium uppercase text-off-black">
          {shortName ?? name}
        </span>
      </span>
      {score == null ? null : <span className="font-mono text-body-lg font-medium text-off-black">{score}</span>}
    </div>
  );
}

function InviteReady({
  details,
  shareUrl,
  onReset,
}: {
  details: RoomDetailsView;
  shareUrl: string;
  onReset: () => void;
}) {
  const router = useRouter();
  const invite = details.invite!;
  const [feedback, setFeedback] = useState<string | null>(null);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setFeedback("Invite link copied");
    } catch {
      setFeedback("Select the link below to copy it");
    }
  };

  const shareInvite = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${details.room.name} on FullTime`,
          text: `${details.fixture.home.name} vs ${details.fixture.away.name} — join our private match room.`,
          url: shareUrl,
        });
        setFeedback("Invite ready to share");
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
      }
    }
    await copyInvite();
  };

  return (
    <section className="mx-auto max-w-5xl" aria-labelledby="invite-ready-title">
      <div className="grid overflow-hidden rounded-[28px] border border-ash lg:grid-cols-[1fr_380px]">
        <div className="p-6 sm:p-10 lg:p-12">
          <span className="grid size-12 place-items-center rounded-full bg-mint text-off-black">
            <CheckCircle2 size={24} strokeWidth={1.8} aria-hidden />
          </span>
          <p className="mt-8 font-mono text-caption uppercase tracking-[0.14em] text-smoke">Room ready</p>
          <h2 id="invite-ready-title" className="mt-3 text-heading text-off-black">Invite your people.</h2>
          <p className="mt-4 max-w-xl font-mono text-body-sm text-graphite">
            {details.room.name} is private. Share this unique link or let friends scan the code; copying it alone never adds Influence.
          </p>

          <div className="mt-8 rounded-lg border border-ash p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Room invite</p>
                <p className="mt-2 text-subheading text-off-black">{details.room.name}</p>
                <p className="mt-1 font-mono text-body-sm text-graphite">
                  {details.fixture.home.name} vs {details.fixture.away.name}
                </p>
              </div>
              <span className="shrink-0 rounded-pill bg-periwinkle-mist px-3 py-2 font-mono text-caption uppercase tracking-[0.08em] text-off-black">Active</span>
            </div>
            <div className="mt-5 flex items-center gap-2 border-t border-ash pt-4 font-mono text-caption text-smoke">
              <Users size={14} strokeWidth={1.8} aria-hidden />
              {invite.viewerSuccessfulJoins === 0
                ? "No friends have joined through you yet"
                : `${invite.viewerSuccessfulJoins} ${invite.viewerSuccessfulJoins === 1 ? "friend has" : "friends have"} joined through you`}
            </div>
          </div>

          <label className="mt-6 block">
            <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">Invite link</span>
            <input
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-2 w-full rounded-lg border border-ash bg-parchment px-4 py-3 font-mono text-body-sm text-off-black focus:border-off-black focus:outline-none"
              aria-label="Invite link"
            />
          </label>

          {feedback ? (
            <p className="mt-3 flex items-center gap-2 font-mono text-caption text-lake-blue" role="status">
              <Check size={14} strokeWidth={2} aria-hidden />
              {feedback}
            </p>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button type="button" variant="primary" onClick={() => void copyInvite()}>
              <Copy size={16} strokeWidth={1.8} aria-hidden />
              Copy invite link
            </Button>
            <Button type="button" variant="ghost" onClick={() => void shareInvite()}>
              <Share2 size={16} strokeWidth={1.8} aria-hidden />
              Share
            </Button>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center border-t border-ash bg-off-black p-8 text-center text-parchment lg:border-l lg:border-t-0">
          <span className="mb-5 flex items-center gap-2 font-mono text-caption uppercase tracking-[0.12em] text-parchment/60">
            <QrCode size={15} strokeWidth={1.8} aria-hidden /> Scan to join
          </span>
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG
              value={shareUrl}
              size={320}
              level="L"
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#242424"
              title={`Join ${details.room.name}`}
              className="h-auto w-full max-w-[320px]"
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 font-mono text-caption uppercase tracking-[0.08em] text-smoke hover:text-off-black"
        >
          <RotateCcw size={14} strokeWidth={1.8} aria-hidden />
          Create another room
        </button>
        <Button type="button" variant="secondary" onClick={() => router.push(`/room/${details.room.id}`)}>
          Enter room
          <ArrowRight size={16} strokeWidth={1.8} aria-hidden />
        </Button>
      </div>
    </section>
  );
}

function CreationSkeleton() {
  return (
    <div className="mx-auto min-w-0 max-w-5xl">
      <div className="flex flex-col gap-4 border-b border-ash pb-5 sm:flex-row sm:items-end sm:justify-between">
        <Skeleton className="h-12 w-52" />
        <Skeleton className="h-9 w-full max-w-80" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-48 w-full rounded-lg" />)}
      </div>
    </div>
  );
}
