"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { tapTransition } from "@/lib/motion";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      whileTap={{ scale: 0.96 }}
      transition={tapTransition}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-200 hairline",
        checked ? "justify-end bg-fg" : "justify-start bg-elevated",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn("size-6 rounded-full", checked ? "bg-bg" : "bg-fg-muted")}
      />
    </motion.button>
  );
}
