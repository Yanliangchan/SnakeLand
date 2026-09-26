"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Chip, CHIP_VALUES, type ChipValue } from "@/components/ui";
import { cn } from "@/lib/cn";
import { tap, tapTransition } from "@/lib/motion";
import { useSettings } from "@/providers/settings";
import { chipId, chipsFor, MAX_STACK, sum, type SlipChip } from "./chips";

const freshTray = () => Object.fromEntries(CHIP_VALUES.map((v) => [v, chipId(v)])) as Record<ChipValue, string>;

/**
 * Bet built from chips. Tray chips and placed chips share a layoutId, so a
 * placed chip flies from the tray to wherever the stack is rendered.
 */
export function useChipSlip(limit: number) {
  const { play } = useSettings();
  const [chips, setChips] = useState<SlipChip[]>([]);
  const [tray, setTray] = useState(freshTray);
  const amount = sum(chips);
  const room = Math.max(0, limit - amount);

  const add = useCallback(
    (value: ChipValue) => {
      if (value > room) return;
      play("click");
      setChips((c) => {
        const next = [...c, { id: tray[value], value }];
        return next.length > MAX_STACK ? chipsFor(sum(next)) : next;
      });
      setTray((t) => ({ ...t, [value]: chipId(value) }));
    },
    [room, tray, play],
  );

  // The limit follows the balance; keep `set` stable so effects that depend on it don't re-run every hand.
  const limitRef = useRef(limit);
  useLayoutEffect(() => {
    limitRef.current = limit;
  }, [limit]);

  /** Replace the stake with an exact amount (clamped to the limit). */
  const set = useCallback(
    (value: number) => setChips(chipsFor(Math.max(0, Math.min(Math.floor(value), limitRef.current)))),
    [],
  );

  return { chips, tray, amount, room, add, set, clear: () => setChips([]) };
}

export type ChipSlip = ReturnType<typeof useChipSlip>;

export function ChipTray({ slip, disabled, className }: { slip: ChipSlip; disabled?: boolean; className?: string }) {
  return (
    <div className={cn("grid max-w-[380px] grid-cols-7 place-items-center gap-1", className)}>
      {CHIP_VALUES.map((v) => (
        <Chip
          key={slip.tray[v]}
          chipId={slip.tray[v]}
          value={v}
          size={38}
          disabled={disabled || v > slip.room}
          onClick={() => slip.add(v)}
        />
      ))}
    </div>
  );
}

/** A pile of placed chips; each sits a few px above the last. */
export function ChipStack({
  chips,
  size = 44,
  step = 6,
  className,
}: {
  chips: SlipChip[];
  size?: number;
  step?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center rounded-full border border-dashed border-hairline-strong", className)}
      style={{ width: size + 20, height: size + 20 }}
    >
      <AnimatePresence>
        {chips.map((c, i) => (
          <div key={c.id} className="absolute" style={{ transform: `translateY(${-i * step}px)`, zIndex: i }}>
            <Chip chipId={c.id} value={c.value} size={size} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Quick({
  onClick,
  disabled,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : tap}
      transition={tapTransition}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 rounded-[8px] px-2.5 text-[12px] font-medium text-fg-muted transition-colors hairline hover:text-fg disabled:opacity-40",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/** Stake summary for instant games: mini stack, amount, and ½ / 2× / clear. */
export function StakeSummary({ slip, limit, disabled }: { slip: ChipSlip; limit: number; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <ChipStack chips={slip.chips} size={32} step={4} />
      <span className="min-w-0 text-[22px] font-semibold tracking-[-0.02em] tabular">{slip.amount.toLocaleString()}</span>
      <div className="ml-auto flex gap-1.5">
        <Quick onClick={() => slip.set(slip.amount / 2)} disabled={disabled || slip.amount === 0}>
          ½
        </Quick>
        <Quick
          onClick={() => slip.set(slip.amount * 2)}
          disabled={disabled || slip.amount === 0 || slip.amount * 2 > limit}>
          2×
        </Quick>
        <Quick onClick={slip.clear} disabled={disabled || slip.amount === 0}>
          Clear
        </Quick>
      </div>
    </div>
  );
}
