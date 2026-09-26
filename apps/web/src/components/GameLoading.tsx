"use client";

import { motion } from "framer-motion";
import { GAMES, type GameId } from "@snakeland/shared";
import { GAME_ACCENT } from "@/lib/games-ui";
import { expoOut } from "@/lib/motion";
import { GameGlyph } from "./GameGlyph";

/** Entry animation while a game's code and state load: its glyph inside an accent ring. */
export function GameLoading({ game }: { game: GameId }) {
  const accent = GAME_ACCENT[game];
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy aria-label={`Loading ${GAMES[game].name}`}>
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: expoOut }}
        className="flex flex-col items-center"
      >
        <div className="relative grid size-20 place-items-center">
          <svg className="absolute inset-0" viewBox="0 0 80 80" aria-hidden>
            <circle cx="40" cy="40" r="37" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="2" />
            <motion.circle
              cx="40"
              cy="40"
              r="37"
              fill="none"
              stroke={accent}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="60 200"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
              style={{ originX: "50%", originY: "50%" }}
            />
          </svg>
          <span style={{ color: accent }}>
            <GameGlyph game={game} size={30} />
          </span>
        </div>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: expoOut, delay: 0.08 }}
          className="mt-5 text-[15px] font-semibold"
        >
          {GAMES[game].name}
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-1 text-[13px] text-fg-muted"
        >
          {GAMES[game].tagline}
        </motion.p>
      </motion.div>
    </div>
  );
}
