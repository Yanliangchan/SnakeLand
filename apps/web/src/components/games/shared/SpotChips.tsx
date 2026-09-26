"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import { Chip, CHIP_VALUES, formatChip, type ChipValue } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useSettings } from "@/providers/settings";
import { chipId, chipsFor, sum, type SlipChip } from "./chips";

const freshTray = () => Object.fromEntries(CHIP_VALUES.map((v) => [v, chipId(v)])) as Record<ChipValue, string>;
const MAX_PER_SPOT = 5;

/**
 * Bets spread over named spots (Player/Banker…, or roulette bet ids). Pick a
 * denomination, tap a spot: the selected tray chip flies to it via its layoutId.
 */
export function useSpotChips<K extends string>(limit: number) {
  const { play } = useSettings();
  const [selected, setSelected] = useState<ChipValue>(10);
  const [tray, setTray] = useState(freshTray);
  const [spots, setSpots] = useState<Partial<Record<K, SlipChip[]>>>({});

  const total = Object.values<SlipChip[] | undefined>(spots).reduce((s, c) => s + sum(c ?? []), 0);
  const amountOf = useCallback((spot: K) => sum(spots[spot] ?? []), [spots]);

  /** Returns the value placed, or null if it would break the limit. */
  const place = useCallback(
    (spot: K, value: ChipValue = selected): ChipValue | null => {
      if (total + value > limit) return null;
      play("click");
      setSpots((s) => {
        const next = [...(s[spot] ?? []), { id: tray[value], value }];
        return { ...s, [spot]: next.length > MAX_PER_SPOT ? chipsFor(sum(next)) : next };
      });
      setTray((t) => ({ ...t, [value]: chipId(value) }));
      return value;
    },
    [selected, total, limit, tray, play],
  );

  /** Set exact amounts (e.g. from the server's view of your bets). */
  const setAmounts = useCallback((amounts: Partial<Record<K, number>>) => {
    setSpots((prev) => {
      const next: Partial<Record<K, SlipChip[]>> = {};
      for (const [k, v] of Object.entries(amounts) as Array<[K, number]>) {
        if (!v) continue;
        // Keep existing chips (no re-animation) when the amount already matches.
        next[k] = sum(prev[k] ?? []) === v ? prev[k]! : chipsFor(v);
      }
      return next;
    });
  }, []);

  const amounts = useCallback(() => {
    const out: Partial<Record<K, number>> = {};
    for (const [k, c] of Object.entries(spots) as Array<[K, SlipChip[]]>) if (sum(c) > 0) out[k] = sum(c);
    return out;
  }, [spots]);

  return { selected, setSelected, tray, spots, total, amountOf, place, setAmounts, amounts, clear: () => setSpots({}) };
}

export type SpotChipsState<K extends string> = ReturnType<typeof useSpotChips<K>>;

/** Denomination picker. The selected chip is raised; placing sends it flying. */
export function ChipSelector<K extends string>({
  state,
  disabled,
  className,
}: {
  state: SpotChipsState<K>;
  disabled?: boolean;
  className?: string;
}) {
  const { play } = useSettings();
  return (
    <div className={cn("grid max-w-[360px] grid-cols-6 place-items-center gap-1 pt-1", className)} role="radiogroup" aria-label="Chip value">
      {CHIP_VALUES.map((v) => (
        <motion.div key={v} animate={{ y: state.selected === v ? -4 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
          <Chip
            chipId={state.tray[v]}
            value={v}
            size={40}
            selected={state.selected === v}
            disabled={disabled}
            onClick={() => {
              play("click");
              state.setSelected(v);
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

/** Chips resting on a spot: the top few stacked, with the total when it differs from the top chip. */
export function SpotStack({ chips, size = 28, className }: { chips: SlipChip[] | undefined; size?: number; className?: string }) {
  const list = chips ?? [];
  const shown = list.slice(-3);
  const total = sum(list);
  return (
    <div className={cn("pointer-events-none relative", className)} style={{ width: size, height: size }}>
      <AnimatePresence>
        {shown.map((c, i) => (
          <div key={c.id} className="absolute inset-0" style={{ transform: `translateY(${-i * 3}px)`, zIndex: i }}>
            <Chip chipId={c.id} value={c.value} size={size} />
          </div>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {list.length > 1 && (
          <motion.span
            key={total}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute -right-2 -top-3 z-10 rounded-full bg-fg px-1 text-[9px] font-bold leading-[14px] text-bg tabular"
          >
            {formatChip(total)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
