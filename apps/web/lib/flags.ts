/**
 * Nation flags as pure CSS gradients — no image assets, so they scale crisply and
 * stay on-system. Keyed by ISO-3166 alpha-2 (the `country` field on a Team). Kept
 * deliberately simplified: recognisable at a glance as a small disc or chip. Shared
 * by the brand mark and the in-app `Flag` component so colours never drift.
 */

export const FLAG_GRADIENTS: Record<string, string> = {
  FR: "linear-gradient(90deg, #0055a4 34%, #ffffff 34% 66%, #ef4135 66%)",
  MA: "radial-gradient(circle at 50% 50%, #006233 0 30%, #c1272d 30%)",
  AR: "linear-gradient(#74acdf 34%, #ffffff 34% 66%, #74acdf 66%)",
  PT: "linear-gradient(90deg, #046a38 42%, #da291c 42%)",
  ES: "linear-gradient(#aa151b 28%, #f1bf00 28% 72%, #aa151b 72%)",
  BR: "radial-gradient(circle at 50% 50%, #ffdf00 0 34%, #009c3b 34%)",
  GB: "linear-gradient(#c8102e, #c8102e) 50% 50% / 100% 30% no-repeat, linear-gradient(#c8102e, #c8102e) 50% 50% / 30% 100% no-repeat, #ffffff",
  NL: "linear-gradient(#ae1c28 34%, #ffffff 34% 66%, #21468b 66%)",
  DE: "linear-gradient(#141414 34%, #dd0000 34% 66%, #ffce00 66%)",
  US: "linear-gradient(#3c3b6e, #3c3b6e) 0 0 / 44% 54% no-repeat, repeating-linear-gradient(180deg, #b22234 0 16.6%, #ffffff 16.6% 33.3%)",
  HR: "linear-gradient(#ff0000 34%, #ffffff 34% 66%, #171796 66%)",
  JP: "radial-gradient(circle at 50% 50%, #bc002d 0 30%, #ffffff 30%)",
  MX: "linear-gradient(90deg, #006847 34%, #ffffff 34% 66%, #ce1126 66%)",
  CA: "linear-gradient(90deg, #d80621 22%, #ffffff 22% 78%, #d80621 78%)",
  IT: "linear-gradient(90deg, #008c45 34%, #ffffff 34% 66%, #cd212a 66%)",
};

export function flagGradient(code?: string | null): string | null {
  if (!code) return null;
  return FLAG_GRADIENTS[code.toUpperCase()] ?? null;
}
