"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { useSettings } from "@/providers/settings";

/** Pill tabs with a sliding highlight. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  const id = useId();
  const { play } = useSettings();
  return (
    <div role="tablist" className={cn("inline-flex rounded-[var(--radius-ui)] bg-surface p-1 hairline", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (active) return;
              play("click");
              onChange(o.value);
            }}
            className={cn(
              "relative h-8 rounded-[9px] px-3.5 text-[13px] font-medium transition-colors",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[9px] bg-elevated hairline"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
