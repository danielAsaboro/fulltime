import type { MatchEvent } from "@fulltime/shared";

import { cn } from "@/lib/cn";

const GOALS = new Set(["goal", "penalty-scored", "own-goal"]);

function labelFor(event: MatchEvent): string {
  if (event.detail) return event.detail;
  const side = event.side ? `${event.side === "home" ? "Home" : "Away"} ` : "";
  return `${side}${event.kind.replace(/-/g, " ")}`;
}

export function EventFeed({ events, className }: { events: MatchEvent[]; className?: string }) {
  if (!events.length) return <p className={cn("py-8 text-center font-mono text-body-sm text-smoke", className)}>No signed match events have reached this peer yet.</p>;
  return (
    <ol className={cn("divide-y divide-ash", className)}>
      {events.map((event) => (
        <li key={String(event.id)} className="flex gap-4 py-3">
          <span className="w-9 shrink-0 pt-0.5 text-right font-mono text-caption tabular text-smoke">{event.minute != null ? `${event.minute}'` : "·"}</span>
          <div className="min-w-0 flex-1"><p className={cn("capitalize text-off-black", GOALS.has(event.kind) ? "font-mono text-body font-medium uppercase tracking-[0.02em]" : "font-mono text-body-sm")}>{labelFor(event)}</p><p className="mt-1 font-mono text-[10px] text-smoke">Feed {String(event.messageId ?? event.id)}</p></div>
        </li>
      ))}
    </ol>
  );
}
