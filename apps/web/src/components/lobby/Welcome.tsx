"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";
import { DAILY_CLAIM_AMOUNT, GAMES, GAME_IDS, STARTING_BALANCE, type GameId } from "@snakeland/shared";
import { Wordmark } from "@/components/AppHeader";
import { GameGlyph } from "@/components/GameGlyph";
import { Button, ButtonLink } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { GAME_ACCENT } from "@/lib/games-ui";
import { expoOut, fadeUp } from "@/lib/motion";

const KIND_LABEL: Record<string, string> = { table: "Table", instant: "Instant", live: "Live" };

const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, ease: expoOut, delay },
});

/** The hero visual: a snake climbing the crash curve, with a live-looking multiplier. */
function HeroSnake() {
  const path = "M 24 250 C 140 246, 230 232, 300 196 S 420 96, 476 30";
  return (
    <div className="relative aspect-[5/3.2] w-full overflow-hidden rounded-[20px] bg-surface hairline">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_10%,rgba(61,220,132,0.14),transparent_55%)]" />
      <svg viewBox="0 0 500 280" className="absolute inset-0 h-full w-full" aria-hidden>
        {[70, 130, 190, 250].map((y) => (
          <line key={y} x1="24" x2="484" y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />
        ))}
        <defs>
          <linearGradient id="snake" x1="0" x2="1">
            <stop offset="0" stopColor="#0f5c31" />
            <stop offset="1" stopColor="#3ddc84" />
          </linearGradient>
        </defs>
        <motion.path
          d={path}
          fill="none"
          stroke="url(#snake)"
          strokeWidth="11"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.4, ease: [0.45, 0, 0.2, 1], delay: 0.3 }}
        />
        <motion.path
          d={path}
          fill="none"
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="5"
          strokeDasharray="2 10"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.4, ease: [0.45, 0, 0.2, 1], delay: 0.3 }}
        />
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.6 }}
          transform="translate(476 30) rotate(-50)"
        >
          <ellipse rx="14" ry="10" fill="#3ddc84" />
          <circle cx="5" cy="-4" r="2.6" fill="#fafafa" />
          <circle cx="5" cy="4" r="2.6" fill="#fafafa" />
          <circle cx="6" cy="-4" r="1.3" fill="#0a0a0a" />
          <circle cx="6" cy="4" r="1.3" fill="#0a0a0a" />
          <motion.path
            d="M 14 0 L 24 0 M 24 0 L 28 -3 M 24 0 L 28 3"
            stroke="#ff4d4d"
            strokeWidth="1.8"
            strokeLinecap="round"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.6 }}
          />
        </motion.g>
      </svg>
      <div className="absolute left-5 top-4 sm:left-6 sm:top-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Crash · live</p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.04em] text-win tabular sm:text-[52px]"
        >
          4.27×
        </motion.p>
      </div>
      <div className="absolute bottom-4 right-5 flex gap-1.5">
        {["1.84×", "12.40×", "2.07×"].map((x) => (
          <span key={x} className="rounded-full bg-bg/70 px-2 py-0.5 text-[11px] text-fg-muted tabular hairline">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

function GameCard({ id, i }: { id: GameId; i: number }) {
  const game = GAMES[id];
  const accent = GAME_ACCENT[id];
  return (
    <motion.li {...rise(i * 0.04)}>
      <div
        className="group flex h-full flex-col justify-between rounded-[var(--radius-card)] border bg-surface p-5 transition-colors"
        style={{ borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }}
      >
        <div className="flex items-start justify-between">
          <span style={{ color: accent }}>
            <GameGlyph game={id} />
          </span>
          <span className="rounded-full px-2 py-0.5 text-[11px] text-fg-muted hairline">{KIND_LABEL[game.kind]}</span>
        </div>
        <div className="mt-10">
          <p className="text-[17px] font-semibold">{game.name}</p>
          <p className="mt-1 text-[13px] text-fg-muted">{game.tagline}</p>
        </div>
      </div>
    </motion.li>
  );
}

const FEATURES = [
  {
    title: "Provably fair",
    body: "Every shoe, board and round is committed before you bet and revealed after. Check any result yourself, right in the game.",
    icon: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z M9 12l2 2 4-4",
  },
  {
    title: "Titles worth chasing",
    body: "Weekly titles for the top three, and gold, silver and bronze names with bigger daily chips for the all-time best.",
    icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z",
  },
  {
    title: "Built for every screen",
    body: "Install it like an app, play with one thumb or the keyboard, and pick up where you left off.",
    icon: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11 18h2",
  },
];

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
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-hairline bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Wordmark />
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#games" className="hidden rounded-[10px] px-3 py-2 text-[14px] text-fg-muted transition-colors hover:text-fg sm:block">
              Games
            </a>
            <a href="#fair" className="hidden rounded-[10px] px-3 py-2 text-[14px] text-fg-muted transition-colors hover:text-fg sm:block">
              Fair play
            </a>
            <Link href="/sign-in" className="rounded-[10px] px-3 py-2 text-[14px] text-fg-muted transition-colors hover:text-fg">
              Sign in
            </Link>
            <ButtonLink href="/sign-up" size="sm">
              Sign up
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-24">
          <div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: expoOut }}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-fg-muted hairline"
            >
              <span className="size-1.5 rounded-full bg-win" /> New: Carrier, Tower, Crossing
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: expoOut, delay: 0.04 }}
              className="mt-6 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[64px] lg:text-[72px]"
            >
              The casino,
              <br />
              <span className="text-fg-muted">minus the noise.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: expoOut, delay: 0.1 }}
              className="mt-6 max-w-md text-[17px] leading-relaxed text-fg-muted"
            >
              Nine games, from Blackjack and Roulette to Crash and Carrier. Virtual chips only, never real money, and every outcome
              provably fair.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: expoOut, delay: 0.16 }}
              className="mt-9 flex flex-col gap-3 sm:flex-row"
            >
              <Button size="lg" loading={pending} onClick={playAsGuest}>
                Play free now
              </Button>
              <ButtonLink href="/sign-up" size="lg" variant="secondary">
                Create account
              </ButtonLink>
            </motion.div>
            <AnimatePresence>
              {error && (
                <motion.p {...fadeUp} role="alert" className="mt-4 text-[14px] text-loss">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.4 }}
              className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-muted tabular"
            >
              <li>{STARTING_BALANCE.toLocaleString()} chips to start</li>
              <li>{DAILY_CLAIM_AMOUNT.toLocaleString()} free every day</li>
              <li>No sign-up needed</li>
            </motion.ul>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: expoOut, delay: 0.15 }}
          >
            <HeroSnake />
          </motion.div>
        </section>

        {/* Games */}
        <section id="games" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <motion.div {...rise()} className="max-w-xl">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-muted">The floor</p>
            <h2 className="mt-2 text-[32px] font-semibold leading-tight sm:text-[40px]">Nine games. No filler.</h2>
          </motion.div>
          <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GAME_IDS.map((id, i) => (
              <GameCard key={id} id={id} i={i} />
            ))}
          </ul>
        </section>

        {/* Features */}
        <section id="fair" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <div className="grid gap-3 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div key={f.title} {...rise(i * 0.06)} className="rounded-[var(--radius-card)] bg-surface p-6 hairline">
                <span className="grid size-10 place-items-center rounded-full text-fg hairline">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={f.icon} />
                  </svg>
                </span>
                <h3 className="mt-5 text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <motion.h2 {...rise()} className="text-[32px] font-semibold leading-tight sm:text-[40px]">
            Up and playing in seconds.
          </motion.h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              ["Take a seat", `Play as a guest with ${STARTING_BALANCE.toLocaleString()} chips, or make an account to keep them.`],
              ["Pick a game", "Tables, instant games and live rounds. Tap ? in any game for a quick guide."],
              ["Climb the board", "Win this week for a title. Stay on top all-time for a coloured name and bigger daily chips."],
            ].map(([t, b], i) => (
              <motion.li key={t} {...rise(i * 0.06)} className="border-t border-hairline pt-5">
                <p className="text-[13px] text-fg-muted tabular">0{i + 1}</p>
                <p className="mt-2 text-[17px] font-semibold">{t}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{b}</p>
              </motion.li>
            ))}
          </ol>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
          <motion.div
            {...rise()}
            className="flex flex-col items-start justify-between gap-6 rounded-[20px] bg-surface p-8 hairline sm:flex-row sm:items-center sm:p-10"
          >
            <div>
              <h2 className="text-[26px] font-semibold leading-tight sm:text-[32px]">Your chips are waiting.</h2>
              <p className="mt-2 text-[14px] text-fg-muted">No download, no deposit. Just play.</p>
            </div>
            <Button size="lg" loading={pending} onClick={playAsGuest}>
              Play free now
            </Button>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-[13px] text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark />
          <p>Virtual chips only. No real money, no purchases, no prizes.</p>
        </div>
      </footer>
    </div>
  );
}
