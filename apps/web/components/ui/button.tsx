import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "quiet";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-btn font-mono uppercase " +
  "min-h-10 tracking-[0.06em] transition-colors select-none whitespace-nowrap " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lake-blue motion-reduce:transition-none " +
  "disabled:opacity-40 disabled:pointer-events-none";

const sizes: Record<Size, string> = {
  sm: "text-caption px-5 py-2.5",
  md: "text-body-sm px-8 py-4",
};

// Lake Blue is the single primary action per screen (design law).
const variants: Record<Variant, string> = {
  primary: "bg-lake-blue text-parchment hover:bg-[#2450bd]",
  secondary: "bg-off-black text-parchment hover:bg-ink",
  ghost: "border border-off-black text-off-black hover:bg-off-black hover:text-parchment",
  quiet: "text-off-black hover:text-lake-blue",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  withArrow?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type LinkProps = CommonProps & { href: string };

export function Button(props: ButtonProps | LinkProps) {
  const { variant = "primary", size = "md", withArrow, fullWidth, className, children } = props;
  const classes = cn(base, sizes[size], variants[variant], fullWidth && "w-full", className);
  const content = (
    <>
      {children}
      {withArrow ? <span aria-hidden>▸</span> : null}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <Link href={props.href} className={classes}>
        {content}
      </Link>
    );
  }

  const { variant: _v, size: _s, withArrow: _a, fullWidth: _f, className: _c, children: _ch, ...rest } =
    props as ButtonProps;
  return (
    <button className={classes} {...rest}>
      {content}
    </button>
  );
}
