"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

const REACTIONS = ["🔥", "⚽", "👏", "😮"];

/** A shortcut to the existing durable message/reaction operations, never fixture events. */
export function ReactionBar({
  onReact,
  onNote,
  onRequireSignIn,
  canParticipate,
  className,
}: {
  onReact: (emoji: string) => Promise<void>;
  onNote: (text: string) => Promise<void>;
  onRequireSignIn: () => void;
  canParticipate: boolean;
  className?: string;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitReaction = async (emoji: string) => {
    if (!canParticipate) return onRequireSignIn();
    setError(null);
    try { await onReact(emoji); } catch (reason) { setError(reason instanceof Error ? reason.message : "Reaction could not be saved."); }
  };
  const submitNote = async () => {
    if (!canParticipate) return onRequireSignIn();
    const text = note.trim();
    if (!text) return;
    setError(null);
    try { await onNote(text); setNote(""); setNoteOpen(false); } catch (reason) { setError(reason instanceof Error ? reason.message : "Note could not be saved."); }
  };
  return <><div className={cn("rounded-pill border border-ash bg-parchment p-1.5", className)}><div className="flex items-center gap-1"><span className="hidden px-2 font-mono text-caption text-smoke sm:inline">Latest room message</span><div className="flex flex-1 items-center justify-around">{REACTIONS.map((emoji) => <button key={emoji} type="button" onClick={() => void submitReaction(emoji)} className="rounded-full px-2 py-1.5 text-body-lg hover:scale-110" aria-label={`React ${emoji}`}>{emoji}</button>)}</div><button type="button" onClick={() => canParticipate ? setNoteOpen(true) : onRequireSignIn()} className="shrink-0 rounded-pill border border-off-black px-4 py-2 font-mono text-caption uppercase tracking-[0.08em] text-off-black hover:bg-off-black hover:text-parchment">+ Note</button></div>{error ? <p className="px-3 pb-1 text-caption text-crimson">{error}</p> : null}</div><Sheet open={noteOpen} onClose={() => setNoteOpen(false)} eyebrow="Durable room message" title="Add a note"><div className="space-y-3"><textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 1000))} rows={3} autoFocus placeholder="What just changed?" className="w-full resize-none rounded-lg border border-ash bg-parchment px-4 py-3 font-mono text-body text-off-black placeholder:text-smoke focus:border-off-black focus:outline-none" /><div className="flex items-center justify-between"><span className="font-mono text-caption tabular text-smoke">{note.length}/1000</span><Button variant="primary" size="sm" onClick={() => void submitNote()} disabled={!note.trim()}>Post note</Button></div></div></Sheet></>;
}
