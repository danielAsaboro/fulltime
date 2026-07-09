import type { TimelineItem } from "@/lib/data";
import { cn } from "@/lib/cn";

const GOAL_KINDS = new Set(["goal", "penalty-scored", "own-goal"]);

function minuteLabel(item: TimelineItem): string {
  const m = item.event?.minute;
  return m != null ? `${m}'` : "·";
}

function ReactionRow({ reactions }: { reactions: NonNullable<TimelineItem["reactions"]> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {reactions.map((r) => (
        <span
          key={r.emoji}
          className="inline-flex items-center gap-1 rounded-pill border border-ash px-2 py-0.5 font-mono text-caption tabular text-graphite"
        >
          <span aria-hidden>{r.emoji}</span>
          {r.count >= 1000 ? `${(r.count / 1000).toFixed(1)}k` : r.count}
        </span>
      ))}
    </div>
  );
}

export function EventFeed({ items, className }: { items: TimelineItem[]; className?: string }) {
  if (items.length === 0) {
    return (
      <p className={cn("py-8 text-center font-mono text-body-sm text-smoke", className)}>
        The room is warming up. Events land here the moment they reach your stream.
      </p>
    );
  }

  return (
    <ol className={cn("divide-y divide-ash", className)}>
      {items.map((item, index) => {
        const isGoal = item.event ? GOAL_KINDS.has(item.event.kind) : false;
        const isEruption = item.kind === "eruption";
        return (
          <li key={item.id} className={cn("flex gap-4 py-4", index === 0 && isEruption && "animate-erupt")}>
            <span className="w-9 shrink-0 pt-0.5 text-right font-mono text-caption tabular text-smoke">
              {minuteLabel(item)}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-off-black",
                  isGoal
                    ? "font-mono text-body font-medium uppercase tracking-[0.02em]"
                    : "font-mono text-body-sm",
                )}
              >
                {item.label}
              </p>
              {item.detail ? (
                <p className="mt-1 font-mono text-caption text-smoke">{item.detail}</p>
              ) : null}
              {item.reactions ? <ReactionRow reactions={item.reactions} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
