"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { BlackjackRoundDTO, RecentResult, ShoeDTO } from "@snakeland/shared";
import { WinCelebration } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fade, fadeUp } from "@/lib/motion";
import { ChipStack } from "../shared/ChipSlip";
import type { SlipChip } from "../shared/chips";
import { CardRow, ResultTag, TotalPill } from "./HandView";

function Recent({ recent, streak }: { recent: RecentResult[]; streak: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-row-reverse gap-1" aria-label="Recent results on this table">
        <AnimatePresence initial={false}>
          {recent.map((r, i) => (
            <motion.span
              key={recent.length - i}
              layout
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: i > 7 ? 0.35 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ duration: 0.25 }}
              title={r}
              className={cn("size-1.5 rounded-full", r === "win" ? "bg-win" : r === "lose" ? "bg-loss" : "bg-fg-disabled")}
            />
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {streak >= 2 && (
          <motion.span key={streak} {...fade} className="text-[12px] text-fg-muted tabular">
            {streak} in a row
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

// A short shake when the dealer busts.
const BUST_SHAKE = [0, -7, 7, -5, 5, -2, 0];

export function Felt({
  round,
  revealing,
  baseSeq,
  dealerBaseSeq = baseSeq,
  shoe,
  recent,
  streak,
  chips,
  onFairness,
}: {
  round: BlackjackRoundDTO | null;
  /** The dealer is still playing out a settled hand: hold the results back. */
  revealing: boolean;
  baseSeq: number;
  /** Deal-order base for the dealer's row (its reveal cards arrive one by one, unstaggered). */
  dealerBaseSeq?: number;
  shoe: ShoeDTO;
  recent: RecentResult[];
  streak: number;
  chips: SlipChip[];
  onFairness: () => void;
}) {
  const settled = round?.phase === "settled" && !revealing;
  const dealerBust = !!round && round.dealer.revealed && round.dealer.total > 21;
  const net = settled ? (round.totalPayout ?? 0) - round.totalBet : 0;
  const multiplier = settled && round.totalBet > 0 ? (round.totalPayout ?? 0) / round.totalBet : 0;
  const betAmount = round ? round.totalBet : chips.reduce((s, c) => s + c.value, 0);

  return (
    <div className="relative flex h-full min-h-[400px] flex-col px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center justify-between">
        <Recent recent={recent} streak={streak} />
        <button
          onClick={onFairness}
          className="flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
        >
          <span className="tabular">
            Shoe {shoe.cardsRemaining}/{shoe.totalCards}
          </span>
          <span aria-hidden className="h-3 w-px bg-hairline-strong" />
          Fair
        </button>
      </div>

      {/* Dealer */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <motion.span
          animate={revealing ? { opacity: [0.45, 1, 0.45] } : { opacity: 1 }}
          transition={revealing ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          className={cn(
            "text-[12px] font-medium uppercase tracking-[0.08em] transition-colors",
            revealing ? "text-fg" : "text-fg-disabled",
          )}
        >
          Dealer
        </motion.span>
        {round && (
          <>
            <motion.div
              animate={dealerBust && !revealing ? { x: BUST_SHAKE } : { x: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <CardRow cards={round.dealer.cards} baseSeq={dealerBaseSeq} dramatic />
            </motion.div>
            <TotalPill total={round.dealer.total} soft={round.dealer.soft} status={dealerBust ? "bust" : undefined} />
          </>
        )}
      </div>

      {/* Centre line: rules, or the round result */}
      <div className="my-1 grid min-h-[48px] shrink-0 place-items-center">
        <AnimatePresence mode="wait">
          {revealing ? (
            <motion.p
              key="dealer-turn"
              {...fade}
              className="text-center text-[13px] font-semibold uppercase tracking-[0.18em] text-fg-muted"
            >
              Dealer&rsquo;s turn
            </motion.p>
          ) : settled ? (
            <motion.div key={`result-${round.id}`} {...fadeUp} className="flex flex-col items-center">
              <WinCelebration trigger={round.id} multiplier={multiplier}>
                <span
                  className={cn(
                    "text-[36px] font-semibold tracking-[-0.03em] tabular",
                    net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-fg-muted",
                  )}
                >
                  {net === 0 ? "Push" : `${net > 0 ? "+" : "−"}${Math.abs(net).toLocaleString()}`}
                </span>
              </WinCelebration>
            </motion.div>
          ) : (
            <motion.p
              key="rules"
              {...fade}
              className="text-center text-[11px] font-medium uppercase tracking-[0.14em] text-fg-disabled"
            >
              Blackjack pays 3 to 2 · Dealer stands on all 17s · Insurance pays 2 to 1
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Player hands */}
      <div className="flex flex-1 flex-wrap items-center justify-center gap-x-10 gap-y-4">
        <AnimatePresence>
          {round?.hands.map((h, i) => {
            const active = round.phase === "player" && i === round.activeHand && round.hands.length > 1;
            const dim = round.phase === "player" && round.hands.length > 1 && i !== round.activeHand;
            return (
              <motion.div
                key={`${round.id}-${i}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: dim ? 0.45 : 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center gap-3"
              >
                <CardRow cards={h.cards} baseSeq={baseSeq} />
                <div className="flex items-center gap-2">
                  <TotalPill total={h.total} soft={h.soft} status={h.status} />
                  {round.hands.length > 1 && (
                    <span className="text-[12px] text-fg-muted tabular">
                      {h.bet.toLocaleString()}
                      {h.doubled && " ×2"}
                    </span>
                  )}
                </div>
                <div className="h-5">
                  <AnimatePresence>
                    {h.result && <ResultTag result={h.result} payout={h.payout ?? 0} bet={h.bet} />}
                    {active && (
                      <motion.span key="active" {...fade} className="text-[12px] text-fg-muted">
                        Your move
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 justify-center pt-2">
        <div className="flex flex-col items-center gap-2">
          <ChipStack chips={chips} />
          <span className="text-[13px] font-medium text-fg-muted tabular">
            {betAmount > 0 ? betAmount.toLocaleString() : "Place your bet"}
          </span>
        </div>
      </div>
    </div>
  );
}
