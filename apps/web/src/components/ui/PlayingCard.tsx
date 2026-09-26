"use client";

import { motion } from "framer-motion";
import { cardVariants } from "@/lib/motion";

export type Suit = "S" | "H" | "D" | "C";
const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** A dealt card. Pass its index as `i` so the stagger lines up with deal order. */
export function PlayingCard({ rank, suit, i, faceDown }: { rank: string; suit: Suit; i: number; faceDown?: boolean }) {
  const red = suit === "H" || suit === "D";
  return (
    <motion.div
      custom={i}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="relative h-[92px] w-[66px] shrink-0 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:h-[112px] sm:w-[80px]"
      aria-label={faceDown ? "Face-down card" : `${rank} of ${suit}`}
    >
      {faceDown ? (
        <div className="size-full rounded-[10px] bg-elevated hairline [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.04)_0_2px,transparent_2px_8px)]" />
      ) : (
        <div
          className="flex size-full flex-col justify-between rounded-[10px] bg-fg p-2 font-semibold tabular"
          style={{ color: red ? "#6B6B6B" : "#0A0A0A" }}
        >
          <span className="text-[15px] leading-none sm:text-[17px]">{rank}</span>
          <span className="self-end text-[20px] leading-none sm:text-[24px]">{SUIT_GLYPH[suit]}</span>
        </div>
      )}
    </motion.div>
  );
}
