"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { DealtCardDTO, HandResult, HandStatus } from "@snakeland/shared";
import { PlayingCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";

export function TotalPill({ total, soft, status }: { total: number; soft: boolean; status?: HandStatus }) {
  const bust = status === "bust";
  const label = status === "blackjack" ? "Blackjack" : bust ? `Bust ${total}` : soft && total < 21 ? `${total - 10}/${total}` : String(total);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={label}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className={cn(
          "inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold tabular hairline",
          bust ? "text-loss" : status === "blackjack" ? "text-win" : "text-fg",
        )}
      >
        {label}
      </motion.span>
    </AnimatePresence>
  );
}

const RESULT_TEXT: Record<HandResult, string> = { win: "Win", blackjack: "Blackjack", push: "Push", lose: "Lose" };

export function ResultTag({ result, payout, bet }: { result: HandResult; payout: number; bet: number }) {
  const net = payout - bet;
  const positive = result === "win" || result === "blackjack";
  return (
    <motion.span
      {...fadeUp}
      className={cn(
        "text-[13px] font-medium tabular",
        positive ? "text-win" : result === "lose" ? "text-loss" : "text-fg-muted",
      )}
    >
      {RESULT_TEXT[result]}
      {net !== 0 && ` ${net > 0 ? "+" : "−"}${Math.abs(net).toLocaleString()}`}
    </motion.span>
  );
}

/**
 * A row of overlapping cards. `baseSeq` is the first draw of the latest
 * update, so only newly dealt cards stagger in (and in deal order).
 */
export function CardRow({ cards, baseSeq }: { cards: DealtCardDTO[]; baseSeq: number }) {
  return (
    <div className="flex">
      <AnimatePresence>
        {cards.map((c, idx) => (
          <PlayingCard
            key={c.seq}
            card={c.code}
            i={Math.max(0, c.seq - baseSeq)}
            className={idx > 0 ? "-ml-10 sm:-ml-12" : undefined}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
