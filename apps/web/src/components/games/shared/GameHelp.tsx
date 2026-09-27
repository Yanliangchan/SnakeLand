"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { GAMES, type GameId } from "@snakeland/shared";
import { Button, Sheet } from "@/components/ui";
import { GAME_ACCENT, GAME_HELP } from "@/lib/games-ui";
import { fadeUp } from "@/lib/motion";

const tourKey = (g: GameId) => `snk:tour:${g}`;

function tourSeen(game: GameId) {
  try {
    return window.localStorage.getItem(tourKey(game)) === "done";
  } catch {
    return true;
  }
}

function markSeen(game: GameId) {
  try {
    window.localStorage.setItem(tourKey(game), "done");
  } catch {
    // ignore
  }
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] bg-bg px-1.5 font-sans text-[11px] font-medium text-fg hairline">
      {children}
    </kbd>
  );
}

/** Full help: how to play plus every keyboard shortcut. Opened with "?" or the help button. */
export function GameHelpSheet({ game, open, onClose }: { game: GameId; open: boolean; onClose: () => void }) {
  const help = GAME_HELP[game];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={`How to play ${GAMES[game].name}`}
      title={
        <>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: GAME_ACCENT[game] }}>
            How to play
          </p>
          <h2 className="mt-1 text-[20px] font-semibold">{GAMES[game].name}</h2>
        </>
      }
    >
      <ol className="flex flex-col gap-3">
        {help.steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-[14px] leading-relaxed">
            <span className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular hairline">
              {i + 1}
            </span>
            <span className="text-fg-muted">{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Keyboard</p>
      <ul className="mt-2 divide-y divide-hairline">
        {help.shortcuts.map(([keys, action]) => (
          <li key={keys} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <span className="text-fg-muted">{action}</span>
            <span className="flex gap-1">
              {keys.split(" / ").map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <span className="text-fg-muted">Switch game</span>
          <Kbd>G</Kbd>
        </li>
        <li className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <span className="text-fg-muted">This help</span>
          <Kbd>?</Kbd>
        </li>
      </ul>
    </Sheet>
  );
}

/** The short first-visit tour: three one-line steps in a card over the stage. */
export function GameTour({ game }: { game: GameId }) {
  // GameShell only renders on the client (behind the session gate), so reading storage here is safe.
  const [step, setStep] = useState(() => (tourSeen(game) ? -1 : 0));
  const steps = GAME_HELP[game].steps;
  const done = () => {
    markSeen(game);
    setStep(-1);
  };
  return (
    <AnimatePresence>
      {step >= 0 && (
        <motion.div
          {...fadeUp}
          role="dialog"
          aria-label="Quick tour"
          className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-sm rounded-[14px] bg-elevated p-4 shadow-2xl shadow-black/50 hairline"
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: GAME_ACCENT[game] }}>
              Quick tour · {step + 1}/{steps.length}
            </p>
            <button onClick={done} className="text-[12px] text-fg-muted hover:text-fg">
              Skip
            </button>
          </div>
          <AnimatePresence mode="wait">
            <motion.p key={step} {...fadeUp} className="mt-2 min-h-10 text-[14px] leading-snug">
              {steps[step]}
            </motion.p>
          </AnimatePresence>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className="h-1 w-5 rounded-full transition-colors"
                  style={{ background: i <= step ? GAME_ACCENT[game] : "rgb(255 255 255 / 0.12)" }}
                />
              ))}
            </div>
            <Button size="sm" onClick={() => (step + 1 < steps.length ? setStep(step + 1) : done())}>
              {step + 1 < steps.length ? "Next" : "Got it"}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
