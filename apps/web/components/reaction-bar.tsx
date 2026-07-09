"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

const REACTIONS = ["🔥", "⚽", "😱", "👏", "💀"];
const MAX_NOTE = 120;

/**
 * Reaction-first bottom bar, sized for one thumb. Reactions fire instantly; notes
 * open a small composer capped at 120 chars. Both anchor to the latest moment.
 */
export function ReactionBar({
  onReact,
  onNote,
  onRequireSignIn,
  canParticipate,
  className,
}: {
  onReact: (emoji: string) => void;
  onNote: (text: string) => void;
  onRequireSignIn: () => void;
  canParticipate: boolean;
  className?: string;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [popped, setPopped] = useState<string | null>(null);

  const react = (emoji: string) => {
    if (!canParticipate) return onRequireSignIn();
    onReact(emoji);
    setPopped(emoji);
    setTimeout(() => setPopped(null), 420);
  };

  const openNote = () => {
    if (!canParticipate) return onRequireSignIn();
    setNoteOpen(true);
  };

  const sendNote = () => {
    const text = note.trim();
    if (!text) return;
    onNote(text);
    setNote("");
    setNoteOpen(false);
  };

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 rounded-pill border border-ash bg-parchment p-1.5",
          className,
        )}
      >
        <div className="flex flex-1 items-center justify-around">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => react(emoji)}
              aria-label={`React ${emoji}`}
              className={cn(
                "rounded-full px-2 py-1.5 text-body-lg transition-transform hover:scale-110",
                popped === emoji && "animate-erupt",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
        <button
          onClick={openNote}
          className="shrink-0 rounded-pill border border-off-black px-4 py-2 font-mono text-caption uppercase tracking-[0.08em] text-off-black hover:bg-off-black hover:text-parchment"
        >
          + Note
        </button>
      </div>

      <Sheet open={noteOpen} onClose={() => setNoteOpen(false)} eyebrow="Anchored to this moment" title="Add a note">
        <div className="space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            rows={3}
            autoFocus
            placeholder="What just changed?"
            className="w-full resize-none rounded-lg border border-ash bg-parchment px-4 py-3 font-mono text-body text-off-black placeholder:text-smoke focus:border-off-black focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="font-mono text-caption tabular text-smoke">
              {note.length}/{MAX_NOTE}
            </span>
            <Button variant="primary" size="sm" onClick={sendNote} disabled={!note.trim()}>
              Post note
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
