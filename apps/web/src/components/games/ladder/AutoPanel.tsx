"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { HiloChoice, LadderRoundDTO } from "@snakeland/shared";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { expoOut } from "@/lib/motion";
import type { useLadderGame } from "./useLadderGame";

const ROUNDS = [5, 10, 25, 50, null] as const;

function NumberInput({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] text-fg-muted">{label}</span>
      <input
        inputMode="numeric"
        value={value ?? ""}
        placeholder="Off"
        onChange={(e) => {
          const n = Math.floor(Number(e.target.value.replace(/[^0-9]/g, "")));
          onChange(e.target.value.trim() === "" || !n ? null : Math.min(n, 1_000_000_000));
        }}
        className="h-9 w-full rounded-[10px] bg-bg px-2.5 text-[13px] tabular outline-none hairline focus:border-fg/40"
      />
    </label>
  );
}

/**
 * Auto play for the ladder games: repeat a bet, climbing a fixed number of
 * steps each round, with optional stop-on-profit and stop-on-loss.
 */
export function AutoPanel({
  g,
  mode,
  maxSteps,
  stepLabel,
  pick,
}: {
  g: ReturnType<typeof useLadderGame>;
  mode: string;
  maxSteps: number;
  /** e.g. "floors", "lanes", "goals", "correct guesses". */
  stepLabel: string;
  pick: (r: LadderRoundDTO) => number | HiloChoice | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [rounds, setRounds] = useState<number | null>(10);
  const [steps, setSteps] = useState(Math.min(2, maxSteps));
  const [stopProfit, setStopProfit] = useState<number | null>(null);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const running = g.auto?.running ?? false;
  const playing = g.round?.status === "playing";
  const clamped = Math.min(steps, maxSteps);

  return (
    <div className="rounded-[12px] hairline">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 text-[13px] font-medium"
      >
        <span className="flex items-center gap-2">
          Auto
          {g.auto && (
            <span className={cn("text-[12px] font-normal tabular", g.auto.profit >= 0 ? "text-win" : "text-loss")}>
              {g.auto.played}
              {g.auto.total ? `/${g.auto.total}` : ""} · {g.auto.profit >= 0 ? "+" : "−"}
              {Math.abs(g.auto.profit).toLocaleString()}
            </span>
          )}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={cn("text-fg-muted transition-transform", open && "rotate-180")}>
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: expoOut }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 border-t border-hairline p-3">
              <div>
                <span className="text-[11px] text-fg-muted">Rounds</span>
                <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Rounds">
                  {ROUNDS.map((n) => (
                    <button
                      key={String(n)}
                      role="radio"
                      aria-checked={rounds === n}
                      disabled={running}
                      onClick={() => setRounds(n)}
                      className={cn(
                        "h-8 flex-1 rounded-[8px] text-[12px] font-medium tabular transition-colors disabled:opacity-40",
                        rounds === n ? "bg-fg text-bg" : "text-fg-muted hairline hover:text-fg",
                      )}
                    >
                      {n ?? "∞"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-fg-muted">
                  Cash out after <span className="font-semibold text-fg tabular">{clamped}</span> {stepLabel}
                </span>
                <div className="flex gap-1">
                  {[-1, 1].map((d) => (
                    <button
                      key={d}
                      disabled={running || clamped + d < 1 || clamped + d > maxSteps}
                      onClick={() => setSteps(clamped + d)}
                      aria-label={d < 0 ? "Fewer" : "More"}
                      className="grid size-8 place-items-center rounded-[8px] text-[15px] hairline disabled:opacity-30"
                    >
                      {d < 0 ? "−" : "+"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <NumberInput label="Stop at profit" value={stopProfit} onChange={setStopProfit} />
                <NumberInput label="Stop at loss" value={stopLoss} onChange={setStopLoss} />
              </div>
              {running ? (
                <Button variant="secondary" onClick={g.stopAuto}>
                  Stop after this round
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={playing || g.slip.amount < 1}
                  onClick={() => void g.startAuto({ rounds, steps: clamped, stopProfit, stopLoss }, mode, pick)}
                >
                  Start auto
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
