"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { Avatar, BalanceCounter } from "@/components/ui";
import { tap, tableSwitch, tapTransition } from "@/lib/motion";
import { useSession } from "@/providers/session";

export interface GameShellProps {
  /** e.g. "Blackjack". */
  title: string;
  /** Short table label shown next to the title, e.g. "Table 3F2A". */
  tableLabel?: string;
  /**
   * Identity of the current table. Changing it cross-fades the felt: the old
   * table fully exits before the new one enters.
   */
  tableId: string;
  onNextTable?: () => void;
  /** Bottom bet control (BetSlip etc). Rendered outside the keyed felt so it never remounts on table switch. */
  controls: React.ReactNode;
  /** The felt/board: the only part that differs per game. */
  children: React.ReactNode;
}

/** Shared layout for all six games: fixed top bar, swappable felt, fixed bottom controls. */
export function GameShell({ title, tableLabel, tableId, onNextTable, controls, children }: GameShellProps) {
  const { me } = useSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="fixed inset-x-0 top-0 z-20 border-b border-hairline bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
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
              <h1 className="truncate text-[15px] font-semibold">{title}</h1>
              <AnimatePresence mode="wait" initial={false}>
                {tableLabel && (
                  <motion.p key={tableLabel} {...tableSwitch} className="text-[12px] text-fg-muted tabular">
                    {tableLabel}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
                <BalanceCounter value={me.wallet.balance} className="text-[15px] font-semibold" />
                <Link href="/settings" aria-label="Account and settings">
                  <Avatar name={me.user.name} />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 pb-44 pt-24 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tableId}
            initial={tableSwitch.initial}
            animate={tableSwitch.animate}
            exit={tableSwitch.exit}
            transition={tableSwitch.transition}
            className="w-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {controls}
        </div>
      </footer>
    </div>
  );
}
