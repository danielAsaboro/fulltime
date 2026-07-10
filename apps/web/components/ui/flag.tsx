import { cn } from "@/lib/cn";
import { flagGradient } from "@/lib/flags";

/** A nation flag as a small disc, matching the brand mark. Falls back to a neutral
 *  disc for unknown codes so the layout never breaks. */
export function Flag({
  code,
  size = 20,
  className,
}: {
  code?: string | null;
  size?: number;
  className?: string;
}) {
  const gradient = flagGradient(code);
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full align-middle", className)}
      style={{
        width: size,
        height: size,
        background: gradient ?? "var(--color-periwinkle-mist)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-ash) 85%, transparent)",
      }}
      title={code ?? undefined}
      aria-hidden
    />
  );
}
