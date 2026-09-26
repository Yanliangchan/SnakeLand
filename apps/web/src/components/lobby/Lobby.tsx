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
      <main className="mx-auto w-full max-w-[1440px] px-3 pb-10 pt-4 sm:px-4 lg:px-6 lg:pt-6">
        <div className="grid gap-3 md:grid-cols-[1.3fr_1fr]">
          <motion.section {...fadeUp} className="flex flex-col justify-between gap-4 rounded-[var(--radius-card)] bg-surface p-5 hairline sm:p-6">
            <div>
              <p className="text-[13px] text-fg-muted" suppressHydrationWarning>
                {greeting()}
                {firstName ? `, ${firstName}` : ""}.
              </p>
              <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Balance</p>
              <h1 className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.035em] sm:text-[52px]">
                <BalanceCounter value={me.wallet.balance} />
                <span className="ml-2 text-[15px] font-normal tracking-normal text-fg-muted">chips</span>
              </h1>
            </div>
            <AnimatePresence>
              {me.user.isGuest && (
                <motion.div {...fadeUp}>
                  <Link
                    href="/sign-up"
                    className="flex items-center justify-between gap-3 rounded-[12px] bg-bg/60 px-4 py-3 text-[13px] transition-colors hairline hover:border-hairline-strong"
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
          </motion.section>
          <DailyClaim />
        </div>

        <h2 className="mt-6 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Games</h2>
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
          className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3"
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
                    className="group flex h-full min-h-32 flex-col justify-between rounded-[var(--radius-card)] bg-surface p-4 transition-colors hairline hover:border-hairline-strong sm:min-h-36 sm:p-5 xl:min-h-44"
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
