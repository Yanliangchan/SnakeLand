"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface RecentItem {
  id: string;
  x100: number;
}

/** Latest outcomes as small pills: green above 1×, red below, grey at 1×. */
export function RecentMultipliers({ items, max = 6 }: { items: RecentItem[]; max?: number }) {
  return (
    <div className="flex items-center gap-1.5 overflow-hidden" aria-label="Recent results">
      <AnimatePresence initial={false} mode="popLayout">
        {items.slice(0, max).map((it, i) => (
          <motion.span
            key={it.id}
            layout
            initial={{ opacity: 0, scale: 0.6, x: -8 }}
            animate={{ opacity: i > max - 3 ? 0.5 : 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular hairline",
              it.x100 > 100 ? "text-win" : it.x100 < 100 ? "text-loss" : "text-fg-muted",
            )}
          >
            {(it.x100 / 100).toFixed(2)}×
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
