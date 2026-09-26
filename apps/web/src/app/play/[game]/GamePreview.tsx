"use client";

import { motion } from "framer-motion";
import { GAMES, type GameId } from "@snakeland/shared";
import { GameGlyph } from "@/components/GameGlyph";
import { GameShell } from "@/components/GameShell";
import { Button } from "@/components/ui";
import { expoOut } from "@/lib/motion";
import { useTable } from "@/lib/use-table";

/** Placeholder felt until each game lands; exercises the shared GameShell. */
export function GamePreview({ game, initialTableId }: { game: GameId; initialTableId: string }) {
  const meta = GAMES[game];
  const { tableId, tableLabel, nextTable } = useTable(initialTableId);

  return (
    <GameShell
      title={meta.name}
      tableId={tableId}
      tableLabel={meta.usesTables ? tableLabel : undefined}
      onNextTable={meta.usesTables ? nextTable : undefined}
      controls={
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-fg-muted">Bets open when {meta.name.toLowerCase()} launches.</p>
          <Button disabled>Place bet</Button>
        </div>
      }
    >
      <div className="grid aspect-[16/10] w-full place-items-center rounded-[var(--radius-card)] bg-surface hairline">
        <div className="flex flex-col items-center text-center">
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: expoOut }}
            className="text-fg-muted"
          >
            <GameGlyph game={game} size={48} />
          </motion.span>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: expoOut, delay: 0.08 }}
            className="mt-6 text-[20px] font-semibold tracking-[var(--tracking-tighter)]"
          >
            {meta.tagline}
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-2 text-[14px] text-fg-muted"
          >
            Opening soon.
          </motion.p>
        </div>
      </div>
    </GameShell>
  );
}
