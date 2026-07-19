"use client";

import {
  BarChart3,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  SmilePlus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Fixture, RoomMarketReference } from "@fulltime/shared";
import type { CompiledRulebook } from "@mutinylabs/slip";
import type { CreatePollInput, PollFeedItem, SendMessageInput } from "@/lib/data";
import { cn } from "@/lib/cn";
import { createFullTimeSlipClient, slipBrowserConfiguration } from "@/lib/slip/config";
import { cacheResolvedPollRulebook, resolvePollRulebook } from "@/lib/slip/rulebook-cache";

const MAX_MESSAGE_LENGTH = 1_000;
const EMOJIS = ["⚽", "🔥", "👏", "😂", "😮", "❤️", "👀", "🏆"];

function compilerFixture(fixture: Fixture) {
  return { competition: fixture.competition, home: fixture.home.name, away: fixture.away.name, kickoff: Number(fixture.kickoff), ...(fixture.rawStatusCode !== undefined ? { gameState: fixture.rawStatusCode } : {}) };
}

export function RoomComposer({
  canParticipate,
  roomClosed = false,
  slowModeSeconds = 0,
  onRequireSignIn,
  onSend,
  onSendAttachment,
  onCreatePoll,
  fixture,
  onAttachMarket,
  onTypingChange,
  draftText,
  onDraftTextChange,
}: {
  canParticipate: boolean;
  roomClosed?: boolean;
  slowModeSeconds?: number;
  onRequireSignIn: () => void;
  onSend: (input: SendMessageInput) => Promise<void>;
  onSendAttachment: (file: File, text: string) => Promise<void>;
  onCreatePoll: (input: CreatePollInput) => Promise<PollFeedItem>;
  fixture?: Fixture;
  onAttachMarket?: (input: RoomMarketReference & { pollId: string }) => Promise<void>;
  onTypingChange?: (typing: boolean) => void;
  /** Optional controlled draft (seed banter one-tap fill). */
  draftText?: string;
  onDraftTextChange?: (text: string) => void;
}) {
  const [internalText, setInternalText] = useState("");
  const text = draftText !== undefined ? draftText : internalText;
  const setText = (value: string) => {
    if (onDraftTextChange) onDraftTextChange(value);
    else setInternalText(value);
  };
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef(false);
  const onTypingChangeRef = useRef(onTypingChange);

  useEffect(() => {
    onTypingChangeRef.current = onTypingChange;
  }, [onTypingChange]);

  useEffect(() => () => {
    if (typingRef.current) onTypingChangeRef.current?.(false);
  }, []);

  const setTyping = (typing: boolean) => {
    if (typingRef.current === typing) return;
    typingRef.current = typing;
    onTypingChangeRef.current?.(typing);
  };

  const send = async () => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    const clean = text.trim();
    if (!clean && !attachment) return;
    setSending(true);
    setError(null);
    try {
      if (attachment) await onSendAttachment(attachment, clean);
      else await onSend({ text: clean });
      setText("");
      setAttachment(null);
      setTyping(false);
      inputRef.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  if (roomClosed) {
    return (
      <div className="border-t border-ash bg-parchment px-5 py-4 text-center text-body-sm text-smoke">
        This room is closed. Its replicated chat history remains read-only.
      </div>
    );
  }

  return (
    <div className="relative border-t border-ash bg-parchment/98 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-[0_-8px_24px_rgba(36,36,36,0.04)] backdrop-blur">
      {pollOpen ? (
        <PollComposer
          onClose={() => setPollOpen(false)}
          onRequireSignIn={onRequireSignIn}
          canParticipate={canParticipate}
          onCompileNatural={fixture ? async (question) => {
            const configuration = slipBrowserConfiguration();
            if (!configuration) throw new Error("Natural-language wagers need the configured Slip compiler and Surfpool gateway.");
            const resolution = await resolvePollRulebook({
              client: createFullTimeSlipClient(),
              configuration,
              request: { fixtureId: String(fixture.id), question, fixture: compilerFixture(fixture) },
            });
            if (resolution.status === "unresolvable") throw new Error(resolution.message);
            return resolution.rulebook;
          } : undefined}
          onCreate={async (input, naturalRulebook) => {
            const configuration = fixture && onAttachMarket ? slipBrowserConfiguration() : null;
            const resolutionPromise = naturalRulebook
              ? Promise.resolve({ status: "resolvable" as const, rulebook: naturalRulebook, cached: true })
              : configuration && fixture
              ? resolvePollRulebook({
                client: createFullTimeSlipClient(),
                configuration,
                request: { fixtureId: String(fixture.id), question: input.question, outcomeLabels: [...input.options], fixture: compilerFixture(fixture) },
              }).catch((reason: unknown) => ({ status: "error" as const, reason }))
              : Promise.resolve(null);
            const [, resolution] = await Promise.all([onCreatePoll(input), resolutionPromise]);
            if (configuration && fixture && resolution?.status === "resolvable") {
              await cacheResolvedPollRulebook({
                configuration,
                request: { fixtureId: String(fixture.id), question: input.question, outcomeLabels: [...input.options], fixture: compilerFixture(fixture) },
                rulebook: resolution.rulebook,
              });
            }
            setPollOpen(false);
            // A successful resolution is cached and consumed by PollMarket as soon
            // as the durable poll projects. Market creation is automatic and does
            // not interrupt poll creation with a second composer/review step.
            if (resolution?.status === "error") setError(resolution.reason instanceof Error ? `Poll published. Market check failed: ${resolution.reason.message}` : "Poll published. Market check failed.");
          }}
        />
      ) : null}

      {error ? (
        <div className="mx-3 mt-2 flex items-center justify-between bg-coral/15 px-3 py-2 text-caption text-graphite sm:mx-5">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {attachment ? (
        <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-xl border border-ash bg-white/55 px-3 py-2 text-caption sm:mx-5">
          <span className="min-w-0 truncate"><Paperclip className="mr-1 inline size-3.5 text-smoke" aria-hidden />{attachment.name} · {formatBytes(attachment.size)}</span>
          <button type="button" onClick={() => setAttachment(null)} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-parchment" aria-label="Remove attachment"><X className="size-3.5" /></button>
        </div>
      ) : null}

      <div className="flex items-end gap-2 px-3 pt-3 sm:px-5">
        <div className="relative flex items-center pb-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (!file) return;
              if (file.size < 1 || file.size > 16 * 1024 * 1024) {
                setError("Attachments must be between 1 byte and 16 MiB.");
                return;
              }
              setError(null);
              setAttachment(file);
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!canParticipate) onRequireSignIn();
              else fileInputRef.current?.click();
            }}
            className="grid size-9 place-items-center rounded-full text-smoke hover:bg-white hover:text-off-black"
            aria-label="Attach encrypted file"
          >
            <Paperclip className="size-4.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPollOpen((open) => !open)}
            className={cn("grid size-9 place-items-center rounded-full text-smoke hover:bg-white hover:text-off-black", pollOpen && "bg-white text-off-black")}
            aria-label="Create poll"
            aria-expanded={pollOpen}
          >
            <BarChart3 className="size-4.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setEmojiOpen((open) => !open)}
            className={cn("grid size-9 place-items-center rounded-full text-smoke hover:bg-white hover:text-off-black", emojiOpen && "bg-white text-off-black")}
            aria-label="Add emoji"
            aria-expanded={emojiOpen}
          >
            <SmilePlus className="size-4.5" aria-hidden />
          </button>

          {emojiOpen ? (
            <div className="absolute bottom-full left-0 z-20 mb-2 grid grid-cols-4 gap-1 border border-ash bg-parchment p-2 shadow-lg">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setText(`${text}${emoji}`.slice(0, MAX_MESSAGE_LENGTH));
                    setEmojiOpen(false);
                    inputRef.current?.focus();
                  }}
                  className="grid size-9 place-items-center rounded-full text-lg hover:bg-periwinkle-mist/60"
                  aria-label={`Add ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 rounded-[18px] border border-ash bg-white/55 px-3 py-2 focus-within:border-off-black">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              setTyping(value.length > 0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={1}
            placeholder={canParticipate ? "Message the room" : "Sign in to join the chat"}
            className="max-h-28 min-h-6 w-full resize-none bg-transparent text-body outline-none placeholder:text-smoke"
            aria-label="Message"
          />
          <div className="mt-0.5 flex items-center justify-between gap-3">
            <span className="text-[10px] text-smoke">
              {slowModeSeconds > 0 ? `Slow mode · ${slowModeSeconds}s` : "Enter to send · Shift + Enter for a line break"}
            </span>
            {text.length >= 800 ? (
              <span className={cn("text-[10px] tabular text-smoke", text.length >= MAX_MESSAGE_LENGTH && "text-crimson")}>
                {text.length}/{MAX_MESSAGE_LENGTH}
              </span>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || (!text.trim() && !attachment)}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-lake-blue text-parchment transition-colors hover:bg-[#2450bd] disabled:pointer-events-none disabled:opacity-35"
          aria-label="Send message"
        >
          {sending ? <LoaderCircle className="size-4.5 animate-spin" aria-hidden /> : <Send className="size-4.5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function PollComposer({
  canParticipate,
  onRequireSignIn,
  onCompileNatural,
  onCreate,
  onClose,
}: {
  canParticipate: boolean;
  onRequireSignIn: () => void;
  onCompileNatural?: (question: string) => Promise<CompiledRulebook>;
  onCreate: (input: CreatePollInput, naturalRulebook?: CompiledRulebook) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"wager" | "poll">(onCompileNatural ? "wager" : "poll");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [naturalRulebook, setNaturalRulebook] = useState<CompiledRulebook | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validOptions = mode === "wager" && naturalRulebook ? naturalRulebook.outcomeLabels : options.map((option) => option.trim()).filter(Boolean);

  const compile = async () => {
    if (!onCompileNatural || !question.trim()) return;
    setSaving(true);
    setError(null);
    try {
      setNaturalRulebook(await onCompileNatural(question.trim()));
    } catch (reason) {
      setNaturalRulebook(null);
      setError(reason instanceof Error ? reason.message : "This wager could not be compiled from verified match data.");
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    if (!question.trim() || validOptions.length < 2) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ question: question.trim(), options: validOptions }, mode === "wager" ? naturalRulebook ?? undefined : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Poll could not be created.");
      setSaving(false);
    }
  };

  return (
    <section className="absolute inset-x-0 bottom-full z-30 max-h-[70dvh] overflow-y-auto border border-ash bg-parchment p-4 shadow-xl sm:left-auto sm:right-4 sm:w-[420px]" aria-label="Create a poll">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-caption uppercase tracking-[0.1em] text-smoke">Room market</p>
          <h2 className="mt-1 text-label">Ask it naturally</h2>
        </div>
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-white" aria-label="Close poll composer">
          <X className="size-4" />
        </button>
      </div>
      {onCompileNatural ? <div className="mt-4 grid grid-cols-2 rounded-full border border-ash bg-white/45 p-1" role="tablist" aria-label="Room post type">
        <button type="button" role="tab" aria-selected={mode === "wager"} onClick={() => { setMode("wager"); setNaturalRulebook(null); setError(null); }} className={cn("min-h-10 rounded-full px-3 text-caption focus-visible:ring-2 focus-visible:ring-lake-blue", mode === "wager" && "bg-off-black text-parchment")}>Natural wager</button>
        <button type="button" role="tab" aria-selected={mode === "poll"} onClick={() => { setMode("poll"); setNaturalRulebook(null); setError(null); }} className={cn("min-h-10 rounded-full px-3 text-caption focus-visible:ring-2 focus-visible:ring-lake-blue", mode === "poll" && "bg-off-black text-parchment")}>Social poll</button>
      </div> : null}
      <label className="mt-4 block">
        <span className="text-caption text-smoke">{mode === "wager" ? "Describe the wager" : "Question"}</span>
        <input
          value={question}
          onChange={(event) => { setQuestion(event.target.value); setNaturalRulebook(null); }}
          maxLength={160}
          placeholder={mode === "wager" ? "Will both teams score? Yes or no." : "Who changes the game next?"}
          className="mt-1 w-full border border-ash bg-white/50 px-3 py-2.5 text-body outline-none focus:border-off-black"
        />
      </label>
      {mode === "poll" ? <div className="mt-3 space-y-2">
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-ash text-[10px] text-smoke">{index + 1}</span>
            <input
              value={option}
              onChange={(event) => setOptions((values) => values.map((value, optionIndex) => (optionIndex === index ? event.target.value : value)))}
              maxLength={80}
              placeholder={`Option ${index + 1}`}
              className="min-w-0 flex-1 border-b border-ash bg-transparent px-1 py-2 text-body-sm outline-none focus:border-off-black"
            />
            {options.length > 2 ? (
              <button type="button" onClick={() => setOptions((values) => values.filter((_, optionIndex) => optionIndex !== index))} aria-label={`Remove option ${index + 1}`}>
                <X className="size-3.5 text-smoke" />
              </button>
            ) : null}
          </div>
        ))}
      </div> : naturalRulebook ? <div className="mt-4 rounded-xl border border-lake-blue/30 bg-periwinkle-mist/35 p-3"><p className="text-caption uppercase tracking-[0.08em] text-lake-blue">Verified Rulebook</p><p className="mt-1 text-body-sm text-off-black">{naturalRulebook.sentence}</p><div className="mt-3 flex flex-wrap gap-2">{naturalRulebook.outcomeLabels.map((label) => <span key={label} className="rounded-full border border-ash bg-white/65 px-3 py-1.5 text-caption">{label}</span>)}</div></div> : <p className="mt-3 text-caption text-smoke">FullTime will derive 2–5 complete outcomes, then show the exact TxLINE Rulebook before publishing.</p>}
      {mode === "poll" && options.length < 5 ? (
        <button type="button" onClick={() => setOptions((values) => [...values, ""])} className="mt-3 inline-flex items-center gap-1.5 text-caption text-lake-blue">
          <Plus className="size-3.5" /> Add option
        </button>
      ) : null}
      {error ? <p className="mt-3 text-caption text-crimson">{error}</p> : null}
      <button
        type="button"
        onClick={() => void (mode === "wager" && !naturalRulebook ? compile() : create())}
        disabled={saving || !question.trim() || (mode === "poll" && validOptions.length < 2)}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-lake-blue px-5 py-3 text-caption uppercase tracking-[0.06em] text-parchment disabled:opacity-35"
      >
        {saving ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <BarChart3 className="size-4" />}
        {mode === "wager" ? naturalRulebook ? "Publish wager" : "Build Rulebook" : "Publish poll"}
      </button>
      <p className="mt-2 text-center text-[10px] text-smoke">{mode === "wager" ? "Natural language → verified Rulebook → signed Solana market" : "2–5 options · first vote is final"}</p>
    </section>
  );
}
