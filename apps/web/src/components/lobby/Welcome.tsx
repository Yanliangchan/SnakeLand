"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import { GAMES, GAME_IDS, STARTING_BALANCE } from "@snakeland/shared";
import { Wordmark } from "@/components/AppHeader";
import { GameGlyph } from "@/components/GameGlyph";
import { Button, ButtonLink } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { expoOut, fadeUp } from "@/lib/motion";

export function Welcome() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function playAsGuest() {
    setPending(true);
    setError(null);
    const res = await authClient.signIn.anonymous();
    setPending(false);
    // On success the session hook picks up the new cookie and the lobby replaces this screen.
    if (res.error) setError(res.error.message ?? "Couldn't start a guest session");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <Link href="/sign-in" className="text-[14px] text-fg-muted transition-colors hover:text-fg">
          Sign in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: expoOut }}
          className="max-w-2xl text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[72px]"
        >
          The casino,
          <br />
          <span className="text-fg-muted">minus the noise.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: expoOut, delay: 0.08 }}
          className="mt-6 max-w-md text-[17px] leading-relaxed text-fg-muted"
        >
          Six classics. Virtual chips, never real money. Every outcome provably fair.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: expoOut, delay: 0.16 }}
          className="mt-10 flex flex-col gap-3 sm:flex-row"
        >
          <ButtonLink href="/sign-up" size="lg">
            Create account
          </ButtonLink>
          <Button size="lg" variant="secondary" loading={pending} onClick={playAsGuest}>
            Play as guest
          </Button>
        </motion.div>
        <AnimatePresence>
          {error && (
            <motion.p {...fadeUp} role="alert" className="mt-4 text-[14px] text-loss">
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="mt-4 text-[13px] text-fg-disabled tabular"
        >
          Start with {STARTING_BALANCE.toLocaleString()} chips. Free top-up every day.
        </motion.p>

        <motion.ul
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.05, delayChildren: 0.3 } } }}
          className="mt-20 flex flex-wrap gap-x-8 gap-y-4 text-fg-muted"
        >
          {GAME_IDS.map((id) => (
            <motion.li
              key={id}
              variants={{ hidden: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0, transition: { ease: expoOut } } }}
              className="flex items-center gap-2 text-[14px]"
            >
              <GameGlyph game={id} size={18} />
              {GAMES[id].name}
            </motion.li>
          ))}
        </motion.ul>
      </main>
    </div>
  );
}
