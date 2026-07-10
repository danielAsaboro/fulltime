"use client";

/* Browser-local image previews intentionally use blob URLs. */
/* eslint-disable @next/next/no-img-element */

import {
  BarChart3,
  CircleX,
  ImagePlus,
  LoaderCircle,
  Plus,
  RotateCcw,
  Send,
  SmilePlus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CreatePollInput, MessageAttachment, SendMessageInput } from "@/lib/data";
import { cn } from "@/lib/cn";

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const EMOJIS = ["⚽", "🔥", "👏", "😂", "😮", "❤️", "👀", "🏆"];

export function RoomComposer({
  canParticipate,
  roomClosed = false,
  slowModeSeconds = 0,
  onRequireSignIn,
  onSend,
  onCreatePoll,
}: {
  canParticipate: boolean;
  roomClosed?: boolean;
  slowModeSeconds?: number;
  onRequireSignIn: () => void;
  onSend: (input: SendMessageInput) => Promise<void>;
  onCreatePoll: (input: CreatePollInput) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<MessageAttachment | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const uploadStatus = attachment?.status;

  useEffect(() => {
    if (uploadStatus !== "uploading") return;
    const timer = window.setInterval(() => {
      setAttachment((current) => {
        if (!current || current.status !== "uploading") return current;
        const nextProgress = Math.min(100, current.progress + 12);
        if (sourceFile?.name.toLowerCase().includes("fail") && nextProgress >= 60) {
          return { ...current, progress: nextProgress, status: "failed", error: "Mock upload failed. Retry or choose another image." };
        }
        return { ...current, progress: nextProgress, status: nextProgress === 100 ? "ready" : "uploading" };
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [sourceFile?.name, uploadStatus]);

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSourceFile(file);
    const url = URL.createObjectURL(file);
    const base: MessageAttachment = {
      id: `upload-${Date.now()}`,
      type: "image",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      url,
      status: "uploading",
      progress: 4,
    };
    if (!file.type.startsWith("image/")) {
      setAttachment({ ...base, status: "failed", error: "Choose an image file." });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachment({ ...base, status: "failed", error: "Images must be smaller than 8 MB." });
      return;
    }
    setAttachment(base);
  };

  const clearAttachment = () => {
    if (attachment?.url) URL.revokeObjectURL(attachment.url);
    setAttachment(null);
    setSourceFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    const clean = text.trim();
    if (!clean && !attachment) return;
    if (attachment && attachment.status !== "ready") return;
    setSending(true);
    setError(null);
    try {
      if (attachment) {
        await onSend({ ...(clean ? { text: clean } : {}), attachment });
      } else {
        await onSend({ text: clean });
      }
      setText("");
      // The mock feed retains the blob URL, so do not revoke it after a successful send.
      setAttachment(null);
      setSourceFile(null);
      if (fileRef.current) fileRef.current.value = "";
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
        This room is closed. Its match record and receipts remain available.
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
          onCreate={async (input) => {
            await onCreatePoll(input);
            setPollOpen(false);
          }}
        />
      ) : null}

      {attachment ? (
        <UploadPreview
          attachment={attachment}
          onCancel={() => setAttachment((current) => (current ? { ...current, status: "cancelled" } : current))}
          onRemove={clearAttachment}
          onRetry={() => setAttachment((current) => (current ? { ...current, status: "uploading", progress: 3, error: undefined } : current))}
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

      <div className="flex items-end gap-2 px-3 pt-3 sm:px-5">
        <div className="relative flex items-center pb-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-9 place-items-center rounded-full text-smoke hover:bg-white hover:text-off-black"
            aria-label="Add image"
          >
            <ImagePlus className="size-4.5" aria-hidden />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => chooseImage(event.target.files?.[0])}
          />
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
                    setText((value) => `${value}${emoji}`.slice(0, MAX_MESSAGE_LENGTH));
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
            onChange={(event) => setText(event.target.value)}
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
          disabled={sending || (!text.trim() && !attachment) || Boolean(attachment && attachment.status !== "ready")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-lake-blue text-parchment transition-colors hover:bg-[#2450bd] disabled:pointer-events-none disabled:opacity-35"
          aria-label="Send message"
        >
          {sending ? <LoaderCircle className="size-4.5 animate-spin" aria-hidden /> : <Send className="size-4.5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function UploadPreview({
  attachment,
  onCancel,
  onRemove,
  onRetry,
}: {
  attachment: MessageAttachment;
  onCancel: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const active = attachment.status === "uploading";
  return (
    <div className="mx-3 mt-3 flex items-center gap-3 border border-ash bg-white/45 p-2 sm:mx-5">
      <div className="relative size-14 shrink-0 overflow-hidden bg-ash/30">
        <img src={attachment.url} alt="" className="size-full object-cover" />
        {active ? <span className="absolute inset-0 bg-off-black/20" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption text-off-black">{attachment.name}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-ash/50">
          <span
            className={cn("block h-full transition-[width]", attachment.status === "failed" ? "bg-coral" : "bg-lake-blue")}
            style={{ width: `${attachment.progress}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-smoke">
          {attachment.status === "ready"
            ? "Ready to send"
            : attachment.status === "failed"
              ? attachment.error
              : attachment.status === "cancelled"
                ? "Upload cancelled"
                : `Uploading · ${attachment.progress}%`}
        </p>
      </div>
      {active ? (
        <button type="button" onClick={onCancel} className="grid size-8 place-items-center rounded-full text-smoke hover:bg-parchment" aria-label="Cancel upload">
          <CircleX className="size-4" />
        </button>
      ) : attachment.status === "failed" || attachment.status === "cancelled" ? (
        <button type="button" onClick={onRetry} className="grid size-8 place-items-center rounded-full text-smoke hover:bg-parchment" aria-label="Retry upload">
          <RotateCcw className="size-4" />
        </button>
      ) : null}
      <button type="button" onClick={onRemove} className="grid size-8 place-items-center rounded-full text-smoke hover:bg-parchment" aria-label="Remove image">
        <X className="size-4" />
      </button>
    </div>
  );
}

function PollComposer({
  canParticipate,
  onRequireSignIn,
  onCreate,
  onClose,
}: {
  canParticipate: boolean;
  onRequireSignIn: () => void;
  onCreate: (input: CreatePollInput) => Promise<void>;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validOptions = options.map((option) => option.trim()).filter(Boolean);

  const create = async () => {
    if (!canParticipate) {
      onRequireSignIn();
      return;
    }
    if (!question.trim() || validOptions.length < 2) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ question: question.trim(), options: validOptions });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Poll could not be created.");
      setSaving(false);
    }
  };

  return (
    <section className="absolute inset-x-0 bottom-full z-30 max-h-[70dvh] overflow-y-auto border border-ash bg-parchment p-4 shadow-xl sm:left-auto sm:right-4 sm:w-[420px]" aria-label="Create a poll">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-caption uppercase tracking-[0.1em] text-smoke">Room poll · not scored</p>
          <h2 className="mt-1 text-label">Ask the room</h2>
        </div>
        <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-white" aria-label="Close poll composer">
          <X className="size-4" />
        </button>
      </div>
      <label className="mt-4 block">
        <span className="text-caption text-smoke">Question</span>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={160}
          placeholder="Who changes the game next?"
          className="mt-1 w-full border border-ash bg-white/50 px-3 py-2.5 text-body outline-none focus:border-off-black"
        />
      </label>
      <div className="mt-3 space-y-2">
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
      </div>
      {options.length < 4 ? (
        <button type="button" onClick={() => setOptions((values) => [...values, ""])} className="mt-3 inline-flex items-center gap-1.5 text-caption text-lake-blue">
          <Plus className="size-3.5" /> Add option
        </button>
      ) : null}
      {error ? <p className="mt-3 text-caption text-crimson">{error}</p> : null}
      <button
        type="button"
        onClick={() => void create()}
        disabled={saving || !question.trim() || validOptions.length < 2}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-lake-blue px-5 py-3 text-caption uppercase tracking-[0.06em] text-parchment disabled:opacity-35"
      >
        {saving ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
        Publish poll
      </button>
      <p className="mt-2 text-center text-[10px] text-smoke">2–4 options · social only · no Fan IQ</p>
    </section>
  );
}
