"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ROULETTE_BETS } from "@snakeland/shared";
import { cn } from "@/lib/cn";
import { useMedia } from "@/lib/use-media";
import { SpotStack, type SpotChipsState } from "../shared/SpotChips";
import { HORIZONTAL, VERTICAL, type BoardItem } from "./layout";

const TONE_BG = { red: "bg-[#4A4A4A]", black: "bg-[#161616]", zero: "bg-transparent", plain: "bg-transparent" } as const;

export function BettingBoard({
  spots,
  disabled,
  winning,
  winningBets,
  onPlace,
}: {
  spots: SpotChipsState<string>;
  disabled: boolean;
  /** The number that just came up, highlighted on the layout. */
  winning: number | null;
  winningBets: string[];
  onPlace: (betId: string) => void;
}) {
  const wide = useMedia("(min-width: 640px)");
  const board = wide ? HORIZONTAL : VERTICAL;
  const [hover, setHover] = useState<string | null>(null);
  const covered = useMemo(() => new Set(hover ? ROULETTE_BETS.get(hover)?.numbers : []), [hover]);
  const pct = (it: BoardItem) => ({
    left: `${(it.x / board.width) * 100}%`,
    top: `${(it.y / board.height) * 100}%`,
    width: `${(it.w / board.width) * 100}%`,
    height: `${(it.h / board.height) * 100}%`,
  });
  const chipSize = wide ? 26 : 22;

  return (
    <div
      className={cn("relative mx-auto w-full select-none", !wide && "max-w-[340px]")}
      style={{ aspectRatio: wide ? `${board.width} / ${board.height * 0.95}` : `${board.width} / ${board.height * 0.62}` }}
      onMouseLeave={() => setHover(null)}
    >
      {board.items
        .filter((it) => it.kind === "cell")
        .map((it) => {
          const def = ROULETTE_BETS.get(it.betId)!;
          const lit = hover && def.kind === "straight" && covered.has(def.numbers[0]!);
          const isWin = winning !== null && def.kind === "straight" && def.numbers[0] === winning;
          const outsideWin = winningBets.includes(it.betId) && def.kind !== "straight";
          const vertical = !wide && it.h > it.w;
          return (
            <motion.button
              key={it.betId}
              type="button"
              disabled={disabled}
              onClick={() => onPlace(it.betId)}
              onMouseEnter={() => setHover(it.betId)}
              whileTap={disabled ? undefined : { scale: 0.97 }}
              aria-label={`Bet ${it.label}`}
              className={cn(
                "absolute grid place-items-center border border-[rgba(255,255,255,0.08)] text-[11px] font-semibold tabular transition-colors sm:text-[13px]",
                TONE_BG[it.tone ?? "plain"],
                it.tone === "zero" && "text-fg",
                !disabled && "hover:brightness-125",
                (lit || (hover === it.betId && def.kind !== "straight")) && "!bg-fg/15",
                outsideWin && "!bg-win/10",
              )}
              style={pct(it)}
            >
              <span className={cn(vertical && "-rotate-90 whitespace-nowrap")}>
                {it.betId === "red" ? <span className="inline-block size-2.5 rotate-45 bg-[#6B6B6B] align-middle" aria-label="Red" /> : it.betId === "black" ? <span className="inline-block size-2.5 rotate-45 bg-[#0A0A0A] align-middle ring-1 ring-fg/30" aria-label="Black" /> : it.label}
              </span>
              <AnimatePresence>
                {isWin && (
                  <motion.span
                    key={`win-${winning}`}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: [0, 1, 0.7, 1], scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.9 }}
                    className="pointer-events-none absolute inset-0.5 rounded-[6px] ring-2 ring-fg"
                  />
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}

      {/* Inside-bet hotspots sit on the borders; invisible until hovered or holding chips. */}
      {board.items
        .filter((it) => it.kind === "hot")
        .map((it) => (
          <button
            key={it.betId}
            type="button"
            disabled={disabled}
            onClick={() => onPlace(it.betId)}
            onMouseEnter={() => setHover(it.betId)}
            aria-label={`Bet ${it.betId.replace(":", " ")}`}
            className="absolute z-10 rounded-full"
            style={pct(it)}
          >
            <span className={cn("absolute inset-[30%] rounded-full transition-colors", hover === it.betId && !disabled && "bg-fg/60")} />
          </button>
        ))}

      {/* Placed chips, centred on their spot. */}
      {board.items.map((it) => {
        const chips = spots.spots[it.betId];
        if (!chips?.length) return null;
        const won = winningBets.includes(it.betId);
        return (
          <div
            key={`chips-${it.betId}`}
            className="pointer-events-none absolute z-20 grid place-items-center"
            style={{ left: `${((it.x + it.w / 2) / board.width) * 100}%`, top: `${((it.y + it.h / 2) / board.height) * 100}%`, transform: "translate(-50%, -50%)" }}
          >
            <SpotStack chips={chips} size={chipSize} className={cn(won && "rounded-full ring-2 ring-win ring-offset-2 ring-offset-bg")} />
          </div>
        );
      })}
    </div>
  );
}
