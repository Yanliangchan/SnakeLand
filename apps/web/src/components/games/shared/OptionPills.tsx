"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/cn";

/** Compact radio pills for a game setting (difficulty, speed). */
export function OptionPills<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex h-9 rounded-[10px] p-0.5 hairline" role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          disabled={disabled}
          onClick={() => onChange(o)}
          className={cn(
            "relative h-8 min-w-12 flex-1 rounded-[8px] px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40",
            o === value ? "text-bg" : "text-fg-muted hover:text-fg",
          )}
        >
          {o === value && (
            <motion.span
              layoutId={`pill-${id}`}
              className="absolute inset-0 rounded-[8px] bg-fg"
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
            />
          )}
          <span className="relative">{label(o)}</span>
        </button>
      ))}
    </div>
  );
}
