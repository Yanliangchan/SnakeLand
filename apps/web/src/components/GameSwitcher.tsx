"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FFA_GAMES, GAMES, GAME_IDS, type GameId } from "@snakeland/shared";
import { GameGlyph } from "@/components/GameGlyph";
import { GAME_ACCENT } from "@/lib/games-ui";
import { cn } from "@/lib/cn";
import { expoOut } from "@/lib/motion";
import { useEventPlay } from "./events/EventPlay";

/**
 * The game title doubles as a switcher: tap it (or press G) for every game,
 * one tap away. Escape or a click outside closes it.
 */
export function GameSwitcher({ game, title }: { game: GameId; title: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // In an event, only its games are offered (and keep the event).
  const event = useEventPlay()?.event ?? null;
  const eventId = event?.id ?? null;
  const games: readonly GameId[] = !event ? GAME_IDS : event.mode === "race" ? [game] : FFA_GAMES;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key.toLowerCase() !== "g" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [role=dialog]")) return;
      setOpen((o) => !o);
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Switch game (G)"
        className="flex min-w-0 items-center gap-1.5 rounded-[8px] py-0.5 pr-1 text-left transition-colors hover:text-fg"
      >
        <h1 className="truncate text-[15px] font-semibold">{title}</h1>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={cn("shrink-0 text-fg-muted transition-transform", open && "rotate-180")}>
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: expoOut }}
            className="absolute left-0 top-full z-50 mt-2 grid w-[min(92vw,420px)] origin-top-left grid-cols-3 gap-1.5 rounded-[var(--radius-card)] bg-elevated p-2 shadow-[0_16px_48px_rgba(0,0,0,0.6)] hairline"
          >
            {games.map((id) => (
              <Link
                key={id}
                href={eventId ? `/play/${id}?event=${eventId}` : `/play/${id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                aria-current={id === game ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-[12px] px-1 py-2.5 text-[12px] font-medium transition-colors hover:bg-surface",
                  id === game ? "bg-surface text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <span style={{ color: GAME_ACCENT[id] }}>
                  <GameGlyph game={id} size={24} />
                </span>
                {GAMES[id].name}
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
