"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface LivePlayerRow {
  key: string;
  name: string;
  isMe: boolean;
  amount: number;
  /** Right-hand status: a cash-out, a result, or what they're on. */
  status: React.ReactNode;
}

/** Everyone at a live table and what they've bet, updated as bets land. */
export function LivePlayers({ rows, players, className }: { rows: LivePlayerRow[]; players: number; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">At the table · {players}</p>
      <ul className="mt-2 max-h-40 divide-y divide-hairline overflow-y-auto text-[13px] lg:max-h-56">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li
              key={r.key}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <span className={cn("min-w-0 truncate", r.isMe ? "font-medium text-fg" : "text-fg-muted")}>{r.isMe ? "You" : r.name}</span>
              <span className="flex shrink-0 items-center gap-2 tabular">
                <span>{r.amount.toLocaleString()}</span>
                {r.status}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
