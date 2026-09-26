"use client";

import { motion } from "framer-motion";
import { rankOf, suitOf, type Card } from "@snakeland/shared";
import { cn } from "@/lib/cn";
import { cardVariants, expoOut } from "@/lib/motion";

const SUIT_GLYPH = { S: "♠", H: "♥", D: "♦", C: "♣" } as const;
const SUIT_NAME = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" } as const;
const RANK_LABEL: Record<string, string> = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };
const RANK_NAME: Record<string, string> = { A: "Ace", T: "10", J: "Jack", Q: "Queen", K: "King" };

/**
 * A dealt card. Pass the deal order as `i` so the stagger follows the deal.
 * `card = null` renders face-down; supplying the code later flips it over.
 */
export function PlayingCard({ card, i, className }: { card: Card | null; i: number; className?: string }) {
  const faceDown = card === null;
  const rank = card ? rankOf(card) : null;
  const suit = card ? suitOf(card) : null;
  const red = suit === "H" || suit === "D";

  return (
    <motion.div
      custom={i}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn("relative h-[92px] w-[66px] shrink-0 [perspective:800px] sm:h-[112px] sm:w-[80px]", className)}
      role="img"
      aria-label={card ? `${RANK_NAME[rank!] ?? rank} of ${SUIT_NAME[suit!]}` : "Face-down card"}
    >
      <motion.div
        className="relative size-full [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateY: faceDown ? 180 : 0 }}
        transition={{ duration: 0.45, ease: expoOut }}
      >
        {card && (
          <div
            className="absolute inset-0 flex flex-col justify-between rounded-[10px] bg-fg p-2 font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.55)] [backface-visibility:hidden] tabular"
            style={{ color: red ? "#6B6B6B" : "#0A0A0A" }}
          >
            <span className="flex flex-col items-start leading-none">
              <span className="text-[16px] sm:text-[18px]">{RANK_LABEL[rank!] ?? rank}</span>
              <span className="mt-0.5 text-[12px] sm:text-[13px]">{SUIT_GLYPH[suit!]}</span>
            </span>
            <span className="self-end text-[24px] leading-none sm:text-[28px]">{SUIT_GLYPH[suit!]}</span>
          </div>
        )}
        <div className="absolute inset-0 rounded-[10px] bg-elevated shadow-[0_2px_10px_rgba(0,0,0,0.55)] hairline [backface-visibility:hidden] [transform:rotateY(180deg)] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.045)_0_2px,transparent_2px_8px)]" />
      </motion.div>
    </motion.div>
  );
}
