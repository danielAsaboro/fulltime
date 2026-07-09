/**
 * The signature Monad pipeline imagery, mapped to FullTime's data flow: TxLINE
 * sources are normalized at the hub (soft mint glow) and fan out to the room's
 * playable surfaces. Pill nodes with 1px Ash borders, connected by thin curved
 * Ash lines. Horizontal by nature — scrolls in its own container on small screens.
 */

const SOURCES = [
  { icon: "⤳", label: "Scores feed", y: 46 },
  { icon: "⤳", label: "Odds feed", y: 158 },
  { icon: "⤳", label: "Match events", y: 270 },
];

const OUTPUTS = [
  { icon: "→", label: "Live calls", y: 46 },
  { icon: "→", label: "Market Says", y: 158 },
  { icon: "→", label: "Receipts", y: 270 },
];

const PILL_W = 210;
const PILL_H = 52;
const HUB_W = 240;
const HUB_H = 84;
const SRC_X = 12;
const HUB_X = (960 - HUB_W) / 2; // 360
const OUT_X = 960 - 12 - PILL_W; // 738
const MID_Y = 180;

function NodePill({ icon, label, hub = false }: { icon: string; label: string; hub?: boolean }) {
  return (
    <div
      className={`flex h-full w-full items-center gap-2.5 rounded-pill border border-ash px-5 ${
        hub ? "bg-parchment" : "bg-parchment"
      }`}
    >
      <span className="text-caption text-smoke" aria-hidden>
        {icon}
      </span>
      <span
        className={`whitespace-nowrap font-mono uppercase tracking-[0.06em] text-off-black ${
          hub ? "text-body font-medium" : "text-body-sm"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

export function PipelineDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 960 360"
        className="w-full min-w-[720px]"
        role="img"
        aria-label="TxLINE data flows into normalized state, then out to calls, Market Says, and receipts"
      >
        <defs>
          <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-mint)" stopOpacity="0.55" />
            <stop offset="70%" stopColor="var(--color-mint)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx={960 / 2} cy={MID_Y} r={150} fill="url(#hubGlow)" />

        {SOURCES.map((s) => {
          const y = s.y + PILL_H / 2;
          return (
            <path
              key={`src-${s.label}`}
              d={`M ${SRC_X + PILL_W},${y} C ${SRC_X + PILL_W + 70},${y} ${HUB_X - 70},${MID_Y} ${HUB_X},${MID_Y}`}
              fill="none"
              stroke="var(--color-ash)"
              strokeWidth="1.5"
            />
          );
        })}
        {OUTPUTS.map((o) => {
          const y = o.y + PILL_H / 2;
          return (
            <path
              key={`out-${o.label}`}
              d={`M ${HUB_X + HUB_W},${MID_Y} C ${HUB_X + HUB_W + 70},${MID_Y} ${OUT_X - 70},${y} ${OUT_X},${y}`}
              fill="none"
              stroke="var(--color-ash)"
              strokeWidth="1.5"
            />
          );
        })}

        {SOURCES.map((s) => (
          <foreignObject key={`sn-${s.label}`} x={SRC_X} y={s.y} width={PILL_W} height={PILL_H}>
            <NodePill icon={s.icon} label={s.label} />
          </foreignObject>
        ))}

        <foreignObject x={HUB_X} y={MID_Y - HUB_H / 2} width={HUB_W} height={HUB_H}>
          <NodePill icon="●" label="FullTime · normalized" hub />
        </foreignObject>

        {OUTPUTS.map((o) => (
          <foreignObject key={`on-${o.label}`} x={OUT_X} y={o.y} width={PILL_W} height={PILL_H}>
            <NodePill icon={o.icon} label={o.label} />
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}
