"use client";

import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { fade, tap, tapTransition } from "@/lib/motion";
import { useSettings } from "@/providers/settings";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-fg text-bg hover:bg-white disabled:bg-elevated disabled:text-fg-disabled",
  secondary: "bg-elevated text-fg hairline hover:border-hairline-strong disabled:text-fg-disabled",
  ghost: "bg-transparent text-fg-muted hover:text-fg disabled:text-fg-disabled",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-[15px]",
  lg: "h-13 px-6 text-[16px]",
};

const base =
  "relative inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-ui)] font-medium tracking-[var(--tracking-tightish)] transition-colors duration-150 disabled:cursor-not-allowed";

export function buttonClasses(variant: Variant = "primary", size: Size = "md", block?: boolean, className?: string) {
  return cn(base, variants[variant], sizes[size], block && "w-full", className);
}

const MotionLink = motion.create(Link);

/** Navigation styled as a button (an <a>, so it is never nested inside a <button>). */
export function ButtonLink({
  href,
  variant,
  size,
  block,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { play } = useSettings();
  return (
    <MotionLink
      href={href}
      whileTap={tap}
      transition={tapTransition}
      onClick={() => play("click")}
      className={buttonClasses(variant, size, block, className)}
    >
      {children}
    </MotionLink>
  );
}

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  /** Play the UI click on press (only audible if sound is enabled). */
  clickSound?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, clickSound = true, className, disabled, children, onClick, ...rest },
  ref,
) {
  const { play } = useSettings();
  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? undefined : tap}
      transition={tapTransition}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (clickSound) play("click");
        onClick?.(e);
      }}
      className={buttonClasses(variant, size, block, className)}
      {...rest}
    >
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span key="loading" {...fade} className="flex items-center" aria-label="Loading">
            <Spinner />
          </motion.span>
        ) : (
          <motion.span key="label" {...fade} className="flex items-center gap-2">
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
});

function Spinner() {
  return (
    <motion.svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </motion.svg>
  );
}
