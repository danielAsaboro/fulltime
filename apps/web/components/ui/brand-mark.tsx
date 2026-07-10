import { cn } from "@/lib/cn";

/**
 * FullTime brand mark — a monochrome line-art football at the centre, ringed by
 * the nations of the tournament. The ball stays editorial (Off-Black seams on
 * Parchment); the flag ring carries the only colour, as a deliberate World-Cup
 * flourish. Flags orbit while staying upright (ring rotates, faces counter-rotate).
 */

const COUNTRIES: { code: string; flag: string }[] = [
  { code: "Brazil", flag: "radial-gradient(circle at 50% 50%, #ffdf00 0 34%, #009c3b 34%)" },
  { code: "Argentina", flag: "linear-gradient(#74acdf 34%, #ffffff 34% 66%, #74acdf 66%)" },
  { code: "France", flag: "linear-gradient(90deg, #0055a4 34%, #ffffff 34% 66%, #ef4135 66%)" },
  { code: "Germany", flag: "linear-gradient(#141414 34%, #dd0000 34% 66%, #ffce00 66%)" },
  { code: "Spain", flag: "linear-gradient(#aa151b 28%, #f1bf00 28% 72%, #aa151b 72%)" },
  { code: "Portugal", flag: "linear-gradient(90deg, #046a38 42%, #da291c 42%)" },
  { code: "Netherlands", flag: "linear-gradient(#ae1c28 34%, #ffffff 34% 66%, #21468b 66%)" },
  { code: "Mexico", flag: "linear-gradient(90deg, #006847 34%, #ffffff 34% 66%, #ce1126 66%)" },
  { code: "USA", flag: "linear-gradient(135deg, #3c3b6e 0 46%, #b22234 46%)" },
  { code: "Morocco", flag: "radial-gradient(circle at 50% 50%, #006233 0 30%, #c1272d 30%)" },
];

function Ball() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="15" fill="var(--color-parchment)" stroke="var(--color-off-black)" strokeWidth="1.4" />
      <polygon points="16,11 20.76,14.45 18.94,20.05 13.06,20.05 11.24,14.45" fill="var(--color-off-black)" />
      <g stroke="var(--color-off-black)" strokeWidth="1.2" strokeLinecap="round">
        <line x1="16" y1="11" x2="16" y2="2.2" />
        <line x1="20.76" y1="14.45" x2="28.8" y2="11.7" />
        <line x1="18.94" y1="20.05" x2="24" y2="27" />
        <line x1="13.06" y1="20.05" x2="8" y2="27" />
        <line x1="11.24" y1="14.45" x2="3.2" y2="11.7" />
      </g>
    </svg>
  );
}

export function BrandMark({
  size = 40,
  spin = true,
  className,
}: {
  size?: number;
  spin?: boolean;
  className?: string;
}) {
  const ring = size * 0.43;
  const flag = Math.max(5, Math.round(size * 0.17));
  const ball = Math.round(size * 0.52);
  const anim = spin ? "orbit-turn 42s linear infinite" : undefined;
  const animReverse = spin ? "orbit-turn 42s linear infinite reverse" : undefined;

  return (
    <span
      className={cn("relative inline-block shrink-0 align-middle", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="absolute inset-0" style={{ animation: anim }}>
        {COUNTRIES.map((country, index) => {
          const angle = (index / COUNTRIES.length) * 2 * Math.PI;
          const x = size / 2 + ring * Math.sin(angle);
          const y = size / 2 - ring * Math.cos(angle);
          return (
            <span
              key={country.code}
              className="absolute"
              style={{ left: x, top: y, transform: "translate(-50%, -50%)" }}
            >
              <span
                className="block rounded-full"
                title={country.code}
                style={{
                  width: flag,
                  height: flag,
                  background: country.flag,
                  boxShadow: "0 0 0 1px var(--color-parchment)",
                  animation: animReverse,
                }}
              />
            </span>
          );
        })}
      </span>
      <span
        className="absolute left-1/2 top-1/2"
        style={{ width: ball, height: ball, transform: "translate(-50%, -50%)" }}
      >
        <Ball />
      </span>
    </span>
  );
}
