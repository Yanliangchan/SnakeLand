"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BLACKJACK_RULES, type BlackjackAction, type BlackjackRoundDTO } from "@snakeland/shared";
import { Button } from "@/components/ui";
import { fadeUp } from "@/lib/motion";
import { PanelSection } from "@/components/GameShell";
import { ChipTray, type ChipSlip } from "../shared/ChipSlip";

export type Mode = "loading" | "bet" | "insurance" | "play" | "settled";

const ACTIONS: Array<{ action: BlackjackAction; label: string; key: string }> = [
  { action: "hit", label: "Hit", key: "H" },
  { action: "stand", label: "Stand", key: "S" },
  { action: "double", label: "Double", key: "D" },
  { action: "split", label: "Split", key: "P" },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="hidden rounded-[4px] px-1 text-[10px] font-medium text-current opacity-50 hairline lg:inline">
      {children}
    </kbd>
  );
}

/** The fixed bottom bet slip. Lives outside the felt, so it never remounts on table switch. */
export function BetControls({
  mode,
  round,
  slip,
  pending,
  error,
  onDeal,
  onAction,
  onChangeBet,
}: {
  mode: Mode;
  round: BlackjackRoundDTO | null;
  slip: ChipSlip;
  pending: boolean;
  error: string | null;
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
          <motion.div key="bet" {...fadeUp} className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:gap-6">
            <PanelSection label="Bet" className="flex flex-col gap-2 @4xl:min-w-72 @4xl:flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[22px] font-semibold tracking-[-0.02em] tabular">{slip.amount.toLocaleString()}</span>
                <span className="text-[12px] text-fg-muted tabular">
                  {BLACKJACK_RULES.minBet}–{BLACKJACK_RULES.maxBet.toLocaleString()}
                </span>
              </div>
              <ChipTray slip={slip} disabled={pending} />
            </PanelSection>
            <div className="grid grid-cols-[auto_1fr] gap-2 @4xl:w-64">
              <Button variant="secondary" size="lg" onClick={slip.clear} disabled={slip.amount === 0 || pending}>
                Clear
              </Button>
              <Button size="lg" onClick={onDeal} loading={pending} disabled={slip.amount < BLACKJACK_RULES.minBet}>
                Deal <Kbd>↵</Kbd>
              </Button>
            </div>
          </motion.div>
        )}

        {mode === "insurance" && round && (
          <motion.div key="insurance" {...fadeUp} className="flex flex-col gap-3 @4xl:flex-row @4xl:items-center @4xl:justify-between">
            <p className="text-[14px] text-fg-muted">
              Dealer shows an ace. Insurance costs{" "}
              <span className="text-fg tabular">{round.insurance.stake.toLocaleString()}</span>.
            </p>
            <div className="grid grid-cols-2 gap-2 @4xl:flex">
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
          <motion.div key="play" {...fadeUp} className="grid grid-cols-2 gap-2 @md:grid-cols-4 @4xl:mx-auto @4xl:flex @4xl:justify-center">
            {ACTIONS.map(({ action, label, key }) => (
              <Button
                key={action}
                size="lg"
                variant={action === "hit" || action === "stand" ? "primary" : "secondary"}
                className="@4xl:min-w-28"
                disabled={pending || !round.allowed.includes(action)}
                onClick={() => onAction(action)}
              >
                {label} <Kbd>{key}</Kbd>
              </Button>
            ))}
          </motion.div>
        )}

        {mode === "settled" && (
          <motion.div key="settled" {...fadeUp} className="grid grid-cols-2 gap-2 @4xl:flex @4xl:justify-end">
            <Button variant="secondary" onClick={onChangeBet} disabled={pending}>
              Change bet
            </Button>
            <Button className="@4xl:min-w-40" onClick={onDeal} loading={pending} disabled={slip.amount < BLACKJACK_RULES.minBet}>
              Deal {slip.amount.toLocaleString()} <Kbd>↵</Kbd>
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
