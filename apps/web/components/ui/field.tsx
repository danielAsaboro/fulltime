import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function TextField({
  label,
  hint,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label htmlFor={id} className="block space-y-2">
      {label ? (
        <span className="font-mono text-caption uppercase tracking-[0.1em] text-smoke">{label}</span>
      ) : null}
      <input
        id={id}
        className={cn(
          "w-full rounded-lg border border-ash bg-parchment px-4 py-3 font-mono text-body text-off-black",
          "placeholder:text-smoke focus:border-off-black focus:outline-none",
          className,
        )}
        {...rest}
      />
      {hint ? <span className="block font-mono text-caption text-smoke">{hint}</span> : null}
    </label>
  );
}
