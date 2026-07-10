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
const HUB_W = 290;
const HUB_H = 84;
const SRC_X = 12;
const HUB_X = (960 - HUB_W) / 2;
const OUT_X = 960 - 12 - PILL_W; // 738
const MID_Y = 180;

function NodePill({
  x,
  y,
  width,
  height,
  icon,
  label,
  hub = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  icon: string;
  label: string;
  hub?: boolean;
}) {
  return (
    <g className="pipeline-node">
      <rect
        x={x + 0.75}
        y={y + 0.75}
        width={width - 1.5}
        height={height - 1.5}
        rx={height / 2}
        fill="var(--color-parchment)"
        stroke="var(--color-ash)"
        strokeWidth="1.5"
      />
      <text
        x={x + 22}
        y={y + height / 2}
        dominantBaseline="middle"
        className="pipeline-node-icon"
        aria-hidden
      >
        {icon}
      </text>
      <text
        x={hub ? x + width / 2 + 8 : x + 46}
        y={y + height / 2}
        dominantBaseline="middle"
        textAnchor={hub ? "middle" : undefined}
        className={hub ? "pipeline-node-label pipeline-node-label-hub" : "pipeline-node-label"}
      >
        {label}
      </text>
    </g>
  );
}

const CONNECTORS = [
  ...SOURCES.map((s, i) => ({
    key: `in-${i}`,
    d: `M ${SRC_X + PILL_W},${s.y + PILL_H / 2} C ${SRC_X + PILL_W + 70},${s.y + PILL_H / 2} ${HUB_X - 70},${MID_Y} ${HUB_X},${MID_Y}`,
    delay: i * 0.55,
  })),
  ...OUTPUTS.map((o, i) => ({
    key: `out-${i}`,
    d: `M ${HUB_X + HUB_W},${MID_Y} C ${HUB_X + HUB_W + 70},${MID_Y} ${OUT_X - 70},${o.y + PILL_H / 2} ${OUT_X},${o.y + PILL_H / 2}`,
    delay: 1.9 + i * 0.55,
  })),
];

export function PipelineDiagram({ hero = false }: { hero?: boolean }) {
  return (
    <div className={`pipeline-wrap ${hero ? "pipeline-hero" : ""}`}>
      <div
        className="pipeline-mobile mx-auto max-w-[390px] px-1 sm:hidden"
        role="img"
        aria-label="Scores, odds, and match events flow into FullTime normalized data, then out to calls, Market Says, and receipts"
      >
        <div className="grid grid-cols-3 gap-2">
          {["Scores feed", "Odds feed", "Match events"].map((label) => (
            <span key={label} className="pipeline-mobile-pill">{label}</span>
          ))}
        </div>
        <span className="pipeline-mobile-connector" aria-hidden>↓</span>
        <div className="pipeline-mobile-hub">
          <span aria-hidden>●</span>
          <span>FullTime · normalized</span>
        </div>
        <span className="pipeline-mobile-connector" aria-hidden>↓</span>
        <div className="grid grid-cols-3 gap-2">
          {["Live calls", "Market Says", "Receipts"].map((label) => (
            <span key={label} className="pipeline-mobile-pill">{label}</span>
          ))}
        </div>
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <svg
          viewBox="0 0 960 360"
          className="pipeline-svg w-full min-w-[680px]"
          role="img"
          aria-label="TxLINE data flows into normalized state, then out to calls, Market Says, and receipts"
        >
        <defs>
          <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-mint)" stopOpacity="0.55" />
            <stop offset="70%" stopColor="var(--color-mint)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className="pipeline-glow" cx={960 / 2} cy={MID_Y} r={150} fill="url(#hubGlow)" />

        {CONNECTORS.map((c) => (
          <path
            className="pipeline-line"
            key={c.key}
            d={c.d}
            fill="none"
            stroke="var(--color-ash)"
            strokeWidth="1.5"
          />
        ))}
        {CONNECTORS.map((c) => (
          <circle
            key={`dot-${c.key}`}
            className="pipeline-flow-dot"
            r={3.5}
            cx={0}
            cy={0}
            style={{ offsetPath: `path('${c.d}')`, animationDelay: `${c.delay}s` }}
          />
        ))}

        {SOURCES.map((s) => (
          <NodePill key={`sn-${s.label}`} x={SRC_X} y={s.y} width={PILL_W} height={PILL_H} icon={s.icon} label={s.label} />
        ))}

        <NodePill
          x={HUB_X}
          y={MID_Y - HUB_H / 2}
          width={HUB_W}
          height={HUB_H}
          icon="●"
          label="FullTime · normalized"
          hub
        />

        {OUTPUTS.map((o) => (
          <NodePill key={`on-${o.label}`} x={OUT_X} y={o.y} width={PILL_W} height={PILL_H} icon={o.icon} label={o.label} />
        ))}
        </svg>
      </div>
    </div>
  );
}
