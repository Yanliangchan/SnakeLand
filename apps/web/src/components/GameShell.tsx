"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { GameId } from "@snakeland/shared";
import { Avatar, BalanceCounter } from "@/components/ui";
import { GAME_ACCENT } from "@/lib/games-ui";
import { tap, tableSwitch, tapTransition } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { GameSwitcher } from "./GameSwitcher";
import { GameHelpSheet, GameTour } from "./games/shared/GameHelp";
import { SessionStatsBar } from "./games/shared/SessionStatsBar";

export interface GameShellProps {
  /** Which game: drives the accent colour, help, tour and session stats. */
  game: GameId;
  /** e.g. "Blackjack". */
  title: string;
  /** Short table label shown next to the title, e.g. "Table 3F2A". */
  tableLabel?: string;
  /**
   * Identity of the current table. Changing it cross-fades the stage: the old
   * table fully exits before the new one enters.
   */
  tableId: string;
  onNextTable?: () => void;
  /** Extra header buttons, e.g. live chat. */
  headerExtra?: React.ReactNode;
  /** Bet controls. Rendered outside the keyed stage so they never remount on table switch. */
  controls: React.ReactNode;
  /** The felt/board: the only part that differs per game. */
  children: React.ReactNode;
}

/**
 * Shared layout for every game: a top bar, then two panels that always fit
 * the screen. The stage (the game itself) takes the remaining space; the
 * control panel sits on the left from `lg` up and at the bottom below that.
 * The stage is a size container, so games scale with `cqw`/`cqh` units.
 */
export function GameShell({ game, title, tableLabel, tableId, onNextTable, headerExtra, controls, children }: GameShellProps) {
  const { me } = useSession();
  const [helpOpen, setHelpOpen] = useState(false);
  const accent = GAME_ACCENT[game];

  // "?" opens the help sheet from anywhere in the game.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      e.preventDefault();
      setHelpOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-hairline bg-bg">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-4 px-3 sm:h-16 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <motion.div whileTap={tap} transition={tapTransition}>
              <Link
                href="/"
                aria-label="Back to lobby"
                className="grid size-9 place-items-center rounded-[var(--radius-ui)] text-fg-muted transition-colors hairline hover:text-fg"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </motion.div>
            <div className="min-w-0">
              <GameSwitcher game={game} title={title} />
              <AnimatePresence mode="wait" initial={false}>
                {tableLabel && (
                  <motion.p key={tableLabel} {...tableSwitch} className="text-[12px] text-fg-muted tabular">
                    {tableLabel}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {headerExtra}
            <motion.button
              whileTap={tap}
              transition={tapTransition}
              onClick={() => setHelpOpen(true)}
              aria-label="How to play and shortcuts"
              title="How to play (?)"
              className="grid size-9 place-items-center rounded-[var(--radius-ui)] text-[14px] font-semibold text-fg-muted transition-colors hairline hover:text-fg"
            >
              ?
            </motion.button>
            {onNextTable && (
              <motion.button
                whileTap={tap}
                transition={tapTransition}
                onClick={onNextTable}
                aria-label="Next table"
                className="flex h-9 items-center gap-2 rounded-[var(--radius-ui)] px-2.5 text-[13px] text-fg-muted transition-colors hairline hover:text-fg sm:px-3"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="sm:hidden">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">Next table</span>
              </motion.button>
            )}
            {me && (
              <>
                <div className="flex h-9 items-center gap-1.5 rounded-[var(--radius-ui)] bg-surface px-3 hairline">
                  <BalanceCounter value={me.wallet.balance} className="text-[14px] font-semibold" />
                  <span className="hidden text-[12px] text-fg-muted sm:inline">chips</span>
                </div>
                <Link href="/settings" aria-label="Account and settings">
                  <Avatar name={me.user.name} />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3 lg:flex-row-reverse lg:gap-4 lg:p-4">
        {/* Stage */}
        <main
          className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-card)] bg-surface hairline [container-type:size]"
          style={{ borderColor: `color-mix(in srgb, ${accent} 28%, transparent)` }}
        >
          {/* The game's signature colour, as a hairline across the top of the stage. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={tableId}
              initial={tableSwitch.initial}
              animate={tableSwitch.animate}
              exit={tableSwitch.exit}
              transition={tableSwitch.transition}
              className="h-full w-full overflow-y-auto overflow-x-hidden"
            >
              {children}
            </motion.div>
          </AnimatePresence>
          <GameTour game={game} />
        </main>

        {/* Controls */}
        <aside className="@container shrink-0 rounded-[var(--radius-card)] bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] hairline sm:p-4 lg:w-[340px] lg:overflow-y-auto">
          {controls}
          <SessionStatsBar game={game} />
        </aside>
      </div>
      <GameHelpSheet game={game} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

/** Small labelled section used inside the control panel. */
export function PanelSection({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      {label && <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{label}</p>}
      {children}
    </section>
  );
}
