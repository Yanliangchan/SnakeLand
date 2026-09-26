"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { BaccaratWinner } from "@snakeland/shared";
import { cn } from "@/lib/cn";

const LABEL: Record<BaccaratWinner, string> = { player: "P", banker: "B", tie: "T" };

/** Bead road: one bead per hand, oldest first, filling columns of six. */
export function Road({ road }: { road: BaccaratWinner[] }) {
  const beads = [...road].reverse();
  return (
    <div
      className="grid auto-cols-[14px] grid-flow-col grid-rows-6 gap-[3px] sm:auto-cols-[16px]"
      aria-label="Recent hands"
    >
      <AnimatePresence initial={false}>
        {beads.map((w, i) => (
          <motion.span
            key={`${beads.length - i}-${i}`}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
            title={w}
            className={cn(
              "grid aspect-square place-items-center rounded-full text-[8px] font-bold sm:text-[9px]",
              w === "player" && "bg-fg text-bg",
              w === "banker" && "bg-[#4A4A4A] text-fg",
              w === "tie" && "text-fg-muted ring-1 ring-fg-muted",
            )}
          >
            {LABEL[w]}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
