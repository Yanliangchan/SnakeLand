"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BLACKJACK_RULES, type BlackjackAction, type BlackjackRoundDTO } from "@snakeland/shared";
import { Button, Chip, CHIP_VALUES, type ChipValue } from "@/components/ui";
import { fadeUp } from "@/lib/motion";

export type Mode = "loading" | "bet" | "insurance" | "play" | "settled";

const ACTIONS: Array<{ action: BlackjackAction; label: string; key: string }> = [
  { action: "hit", label: "Hit", key: "H" },
  { action: "stand", label: "Stand", key: "S" },
  { action: "double", label: "Double", key: "D" },
  { action: "split", label: "Split", key: "P" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="hidden rounded-[4px] px-1 text-[10px] font-medium text-current opacity-50 hairline sm:inline">
      {children}
    </kbd>
  );
}

/** The fixed bottom bet slip. Lives outside the felt, so it never remounts on table switch. */
export function BetControls({
  mode,
  round,
  tray,
  bet,
  room,
  pending,
  error,
  onChip,
  onClear,
  onDeal,
  onAction,
  onChangeBet,
}: {
  mode: Mode;
  round: BlackjackRoundDTO | null;
  tray: Record<ChipValue, string>;
  bet: number;
  /** Chips still addable (limited by table max and balance). */
  room: number;
  pending: boolean;
  error: string | null;
  onChip: (value: ChipValue) => void;
  onClear: () => void;
  onDeal: () => void;
  onAction: (action: BlackjackAction) => void;
  onChangeBet: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence>
        {error && (
          <motion.p {...fadeUp} role="alert" className="text-center text-[13px] text-loss">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {mode === "bet" && (
          <motion.div key="bet" {...fadeUp} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-1.5 sm:justify-start sm:gap-2">
              {CHIP_VALUES.map((v) => (
                <Chip key={tray[v]} chipId={tray[v]} value={v} disabled={v > room || pending} onClick={() => onChip(v)} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClear} disabled={bet === 0 || pending}>
                Clear
              </Button>
              <Button className="flex-1 sm:flex-none sm:min-w-36" onClick={onDeal} loading={pending} disabled={bet < BLACKJACK_RULES.minBet}>
                Deal <Kbd>↵</Kbd>
              </Button>
            </div>
          </motion.div>
        )}

        {mode === "insurance" && round && (
          <motion.div key="insurance" {...fadeUp} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-fg-muted">
              Dealer shows an ace. Insurance costs{" "}
              <span className="text-fg tabular">{round.insurance.stake.toLocaleString()}</span>.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button variant="secondary" onClick={() => onAction("no_insurance")} disabled={pending}>
                No thanks <Kbd>N</Kbd>
              </Button>
              <Button onClick={() => onAction("insurance")} disabled={pending}>
                Insure <Kbd>I</Kbd>
              </Button>
            </div>
          </motion.div>
        )}

        {mode === "play" && round && (
          <motion.div key="play" {...fadeUp} className="grid grid-cols-4 gap-2 sm:mx-auto sm:flex sm:justify-center">
            {ACTIONS.map(({ action, label, key }) => (
              <Button
                key={action}
                variant={action === "hit" || action === "stand" ? "primary" : "secondary"}
                className="sm:min-w-28"
                disabled={pending || !round.allowed.includes(action)}
                onClick={() => onAction(action)}
              >
                {label} <Kbd>{key}</Kbd>
              </Button>
            ))}
          </motion.div>
        )}

        {mode === "settled" && (
          <motion.div key="settled" {...fadeUp} className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button variant="secondary" onClick={onChangeBet} disabled={pending}>
              Change bet
            </Button>
            <Button className="sm:min-w-40" onClick={onDeal} loading={pending} disabled={bet < BLACKJACK_RULES.minBet}>
              Deal {bet.toLocaleString()} <Kbd>↵</Kbd>
            </Button>
          </motion.div>
        )}

        {mode === "loading" && (
          <motion.div key="loading" {...fadeUp} className="h-11" />
        )}
      </AnimatePresence>
    </div>
  );
}
