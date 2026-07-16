import { projectCallStreak } from "@fulltime/shared";
import type { FanIqView as FanIqModel, RoomReceiptView } from "@/lib/data";
import { cn } from "@/lib/cn";

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{label}</p>
      <p className="font-mono text-subheading font-medium tabular leading-none text-off-black">{value}</p>
      {sub ? <p className="mt-0.5 font-mono text-caption text-smoke">{sub}</p> : null}
    </div>
  );
}

/** Onside/FanField-style streak + rank strip on top of existing Fan IQ math. */
export function FanIqStrip({
  iq,
  receipts,
  className,
}: {
  iq: FanIqModel;
  /** Chronological receipts for the viewer; used only for streak presentation. */
  receipts?: readonly RoomReceiptView[];
  className?: string;
}) {
  const scored = iq.scoredCalls > 0;
  const streak = projectCallStreak(
    (receipts ?? [])
      .filter((receipt) => receipt.scored || receipt.outcome === "correct" || receipt.outcome === "incorrect")
      .slice()
      .sort((a, b) => Number(a.acceptedAt) - Number(b.acceptedAt))
      .map((receipt) => {
        if (receipt.outcome === "correct" || receipt.outcome === "incorrect" || receipt.outcome === "void") {
          return receipt.outcome;
        }
        return "pending";
      }),
  );
  const trail =
    streak.current >= 2
      ? `${streak.current} hot`
      : streak.current === 1
        ? "on a hit"
        : streak.best >= 2
          ? `best ${streak.best}`
          : undefined;

  return (
    <div className={cn("rounded-lg border border-ash bg-parchment px-5 py-4", className)}>
      <div className="grid grid-cols-3 gap-4">
        <Cell label="Fan IQ" value={scored ? String(iq.fanIq) : "—"} sub={trail} />
        <Cell
          label="Accuracy"
          value={scored ? `${Math.round(iq.accuracy * 100)}%` : "—"}
          sub={scored ? `${iq.correctCalls}/${iq.scoredCalls}` : "no settled calls"}
        />
        <Cell
          label="Room rank"
          value={iq.roomRank > 0 ? `#${iq.roomRank}` : "—"}
          sub={iq.roomSize ? `of ${iq.roomSize}` : undefined}
        />
      </div>
      {iq.leaderboard.length > 1 ? (
        <ol className="mt-3 space-y-1 border-t border-ash pt-3">
          {iq.leaderboard.slice(0, 3).map((entry, index) => (
            <li key={String(entry.userId)} className="flex items-center justify-between gap-2 font-mono text-caption">
              <span className="truncate text-graphite">
                <span className="tabular text-smoke">#{index + 1}</span> {entry.displayName}
              </span>
              <span className="tabular text-off-black">{entry.fanIq}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
