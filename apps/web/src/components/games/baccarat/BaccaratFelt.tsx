"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { BaccaratBet, BaccaratRoundDTO, BaccaratTableDTO } from "@snakeland/shared";
import { WinCelebration } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fade, fadeUp } from "@/lib/motion";
import { CardRow } from "../blackjack/HandView";
import { SpotStack, type SpotChipsState } from "../shared/SpotChips";
import { Road } from "./Road";

const SPOTS: Array<{ id: BaccaratBet; label: string; pays: string; wide?: boolean }> = [
  { id: "playerPair", label: "P Pair", pays: "11:1" },
  { id: "player", label: "Player", pays: "1:1", wide: true },
  { id: "tie", label: "Tie", pays: "8:1" },
  { id: "banker", label: "Banker", pays: "0.95:1", wide: true },
  { id: "bankerPair", label: "B Pair", pays: "11:1" },
];

function Side({
  label,
  cards,
  total,
  won,
}: {
  label: string;
  cards: BaccaratRoundDTO["player"] | null;
  total: number | null;
  won: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-3">
      <span className={cn("text-[12px] font-medium uppercase tracking-[0.08em] transition-colors", won ? "text-fg" : "text-fg-disabled")}>
        {label}
      </span>
      <div className="flex min-h-[92px] items-center sm:min-h-[112px]">{cards && <CardRow cards={cards} baseSeq={0} />}</div>
      <div className="h-7">
        <AnimatePresence mode="wait">
          {total !== null && (
            <motion.span
              key={total}
              {...fadeUp}
              className={cn(
                "inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2.5 text-[14px] font-semibold tabular hairline",
                won ? "bg-fg text-bg" : "text-fg",
              )}
            >
              {total}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function BaccaratFelt({
  table,
  round,
  spots,
  canBet,
  onSpot,
  onFairness,
}: {
  table: BaccaratTableDTO;
  round: BaccaratRoundDTO | null;
  spots: SpotChipsState<BaccaratBet>;
  canBet: boolean;
  onSpot: (spot: BaccaratBet) => void;
  onFairness: () => void;
}) {
  const net = round ? round.totalPayout - round.totalBet : 0;
  const winnerText = round
    ? round.winner === "tie"
      ? `Tie ${round.playerTotal}–${round.bankerTotal}`
      : `${round.winner === "player" ? "Player" : "Banker"} wins ${Math.max(round.playerTotal, round.bankerTotal)}–${Math.min(round.playerTotal, round.bankerTotal)}`
    : null;

  return (
    <div className="relative flex min-h-[460px] flex-col gap-5 rounded-[var(--radius-card)] bg-surface px-4 py-5 hairline sm:min-h-[520px] sm:px-8 sm:py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-h-[105px] overflow-hidden sm:min-h-[113px]">
          <Road road={table.road} />
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={onFairness}
            className="flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
          >
            <span className="tabular">
              Shoe {table.shoe.cardsRemaining}/{table.shoe.totalCards}
            </span>
            <span aria-hidden className="h-3 w-px bg-hairline-strong" />
            Fair
          </button>
          <AnimatePresence>
            {table.streak >= 2 && (
              <motion.span key={table.streak} {...fade} className="text-[12px] text-fg-muted tabular">
                {table.streak} wins in a row
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-start justify-center gap-6 sm:gap-16">
        <Side label="Player" cards={round?.player ?? null} total={round?.playerTotal ?? null} won={round?.winner === "player"} />
        <Side label="Banker" cards={round?.banker ?? null} total={round?.bankerTotal ?? null} won={round?.winner === "banker"} />
      </div>

      <div className="grid min-h-[52px] place-items-center">
        <AnimatePresence mode="wait">
          {round ? (
            <motion.div key={round.id} {...fadeUp} className="flex flex-col items-center gap-1">
              <span className="text-[13px] text-fg-muted">
                {winnerText}
                {round.natural && " · natural"}
              </span>
              <WinCelebration trigger={round.id} multiplier={round.totalBet ? round.totalPayout / round.totalBet : 0}>
                <span className={cn("text-[28px] font-semibold tracking-[-0.03em] tabular", net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-fg-muted")}>
                  {net === 0 ? "Push" : `${net > 0 ? "+" : "−"}${Math.abs(net).toLocaleString()}`}
                </span>
              </WinCelebration>
            </motion.div>
          ) : (
            <motion.p key="rules" {...fade} className="text-center text-[11px] font-medium uppercase tracking-[0.14em] text-fg-disabled">
              Banker pays 0.95 · Tie pays 8 to 1 · Pairs pay 11 to 1
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-auto grid grid-cols-[1fr_1.5fr_1fr_1.5fr_1fr] gap-1.5 sm:gap-2">
        {SPOTS.map((spot) => {
          const returned = round?.returns[spot.id];
          const hadBet = (round?.bets[spot.id] ?? 0) > 0;
          const won = hadBet && (returned ?? 0) > (round?.bets[spot.id] ?? 0);
          const lost = hadBet && returned === 0;
          return (
            <motion.button
              key={spot.id}
              whileTap={canBet ? { scale: 0.97 } : undefined}
              disabled={!canBet}
              onClick={() => onSpot(spot.id)}
              aria-label={`Bet on ${spot.label}`}
              className={cn(
                "relative flex h-24 flex-col items-center justify-between rounded-[12px] px-1 py-2 transition-colors hairline sm:h-28",
                canBet && "hover:border-hairline-strong hover:bg-elevated/40",
                won && "border-win/50 bg-win/5",
                lost && "opacity-60",
              )}
            >
              <span className="text-center text-[11px] font-semibold uppercase tracking-[0.06em] sm:text-[13px]">{spot.label}</span>
              <SpotStack chips={spots.spots[spot.id]} size={30} />
              <span className="text-[10px] text-fg-muted tabular sm:text-[11px]">
                {won ? <span className="text-win">+{((returned ?? 0) - (round?.bets[spot.id] ?? 0)).toLocaleString()}</span> : spot.pays}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
