"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { GAMES, GAME_IDS } from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { GameGlyph } from "@/components/GameGlyph";
import { BalanceCounter } from "@/components/ui";
import { expoOut, fadeUp, tap, tapTransition } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { DailyClaim } from "./DailyClaim";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Lobby() {
  const { me } = useSession();
  if (!me) return null;
  const firstName = me.user.isGuest ? null : me.user.name.split(" ")[0];

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
        <motion.section {...fadeUp}>
          <p className="text-[14px] text-fg-muted" suppressHydrationWarning>
            {greeting()}
            {firstName ? `, ${firstName}` : ""}.
          </p>
          <h1 className="mt-2 text-[48px] font-semibold leading-none tracking-[-0.035em] sm:text-[64px]">
            <BalanceCounter value={me.wallet.balance} />
          </h1>
          <p className="mt-2 text-[14px] text-fg-muted">chips</p>
        </motion.section>

        <div className="mt-10">
          <DailyClaim />
        </div>

        <AnimatePresence>
          {me.user.isGuest && (
            <motion.div {...fadeUp} className="mt-3">
              <Link
                href="/sign-up"
                className="flex items-center justify-between rounded-[var(--radius-card)] px-5 py-4 text-[14px] transition-colors hairline hover:border-hairline-strong"
              >
                <span className="text-fg-muted">
                  Playing as guest. <span className="text-fg">Create an account</span> to keep your chips.
                </span>
                <span aria-hidden className="text-fg-muted">
                  →
                </span>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        <h2 className="mt-16 text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">Games</h2>
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
          className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {GAME_IDS.map((id) => {
            const game = GAMES[id];
            return (
              <motion.li
                key={id}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: expoOut } },
                }}
              >
                <motion.div whileTap={tap} transition={tapTransition}>
                  <Link
                    href={`/play/${id}`}
                    className="group flex aspect-[4/3] flex-col justify-between rounded-[var(--radius-card)] bg-surface p-4 transition-colors hairline hover:border-hairline-strong sm:p-5"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-fg-muted transition-colors group-hover:text-fg">
                        <GameGlyph game={id} />
                      </span>
                      {!game.available && (
                        <span className="rounded-full px-2 py-0.5 text-[11px] text-fg-muted hairline">Soon</span>
                      )}
                    </div>
                    <div>
                      <p className="text-[16px] font-semibold tracking-[var(--tracking-tightish)]">{game.name}</p>
                      <p className="mt-1 hidden text-[13px] text-fg-muted sm:block">{game.tagline}</p>
                    </div>
                  </Link>
                </motion.div>
              </motion.li>
            );
          })}
        </motion.ul>
      </main>
    </div>
  );
}
