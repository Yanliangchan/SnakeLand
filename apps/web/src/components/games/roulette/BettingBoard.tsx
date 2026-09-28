"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { ROULETTE_BETS } from "@snakeland/shared";
import { cn } from "@/lib/cn";
import { useMedia } from "@/lib/use-media";
import { formatChip } from "@/components/ui";
import { SpotStack, type SpotChipsState } from "../shared/SpotChips";
import { HORIZONTAL, VERTICAL, type BoardItem } from "./layout";

const TONE_BG = {
  red: "bg-table-red",
  black: "bg-table-black",
  zero: "bg-table-green",
  plain: "bg-elevated/40",
} as const;
/** Outside bets that carry their pocket colour. */
const OUTSIDE_TONE: Record<string, string> = { red: "bg-table-red", black: "bg-table-black" };

export function BettingBoard({
  spots,
  disabled,
  winning,
  winningBets,
  others = {},
  onPlace,
}: {
  spots: SpotChipsState<string>;
  disabled: boolean;
  /** The number that just came up, highlighted on the layout. */
  winning: number | null;
  winningBets: string[];
  /** Other players' chips by spot: total and who. */
  others?: Record<string, { amount: number; names: string[] }>;
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
  // Fit the board to the stage: as wide as possible without overflowing the height left under the wheel.
  const ratio = wide ? board.width / (board.height * 0.95) : board.width / (board.height * 0.62);
  // On phones it never shrinks below a tappable 260px: the stage scrolls instead.
  const fit = `(100cqh - var(--top, 0px) - 44px) * ${ratio.toFixed(3)}`;
  const width = wide ? `min(100cqw - 24px, ${fit})` : `min(100cqw - 24px, clamp(260px, ${fit}, 380px))`;

  return (
    <div
      className="relative mx-auto select-none overflow-hidden rounded-[10px] ring-1 ring-hairline"
      style={{ width, aspectRatio: `${ratio}` }}
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
                OUTSIDE_TONE[it.betId] ?? TONE_BG[it.tone ?? "plain"],
                "text-fg",
                it.tone === "zero" && "text-fg",
                !disabled && "hover:brightness-125",
                (lit || (hover === it.betId && def.kind !== "straight")) && "z-[1] ring-2 ring-inset ring-fg/80",
                outsideWin && "z-[1] ring-2 ring-inset ring-win",
              )}
              style={pct(it)}
            >
              <span className={cn(vertical && "-rotate-90 whitespace-nowrap")}>
                {it.label}
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

      {/* Other players' chips: a small marker in the spot's corner, so your own stack stays clear. */}
      {board.items.map((it) => {
        const o = others[it.betId];
        if (!o) return null;
        return (
          <div
            key={`others-${it.betId}`}
            title={`${o.names.join(", ")}: ${o.amount.toLocaleString()}`}
            className="pointer-events-none absolute z-[15] flex items-center gap-0.5 rounded-full bg-gold px-1 text-[9px] font-bold leading-[14px] text-black shadow-[0_1px_4px_rgba(0,0,0,0.5)] tabular sm:text-[10px]"
            style={{
              left: `${((it.x + it.w * (it.kind === "hot" ? 0.5 : 0.82)) / board.width) * 100}%`,
              top: `${((it.y + it.h * (it.kind === "hot" ? 0.5 : 0.2)) / board.height) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {o.names.length > 1 && <span className="opacity-70">{o.names.length}·</span>}
            {formatChip(o.amount)}
          </div>
        );
      })}

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
