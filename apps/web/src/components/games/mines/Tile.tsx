"use client";

import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { tapTransition } from "@/lib/motion";

export type TileState = "hidden" | "gem" | "bust" | "mine" | "gem-dim";

function Gem({ dim }: { dim?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-1/2", dim ? "text-fg-disabled" : "text-win")} aria-hidden>
      <path d="M6 3h12l4 6-10 12L2 9z" fill="currentColor" fillOpacity={dim ? 0.15 : 0.18} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 9h20M9 3l3 6 3-6M12 9v12" stroke="currentColor" strokeWidth="1" strokeOpacity="0.6" />
    </svg>
  );
}

function Mine({ hit }: { hit?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-1/2", hit ? "text-bg" : "text-loss/70")} aria-hidden>
      <circle cx="12" cy="13" r="6.5" fill="currentColor" />
      <path d="M12 3.5v3M4.5 13h-2M21.5 13h-2M6.3 7.3 5 6M17.7 7.3 19 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** One tile. The face swaps with a quick flip so nothing "appears" without motion. */
export function Tile({
  index,
  state,
  disabled,
  onPick,
  delay = 0,
}: {
  index: number;
  state: TileState;
  disabled: boolean;
  onPick: (index: number) => void;
  delay?: number;
}) {
  const hidden = state === "hidden";
  return (
    <motion.button
      type="button"
      aria-label={hidden ? `Tile ${index + 1}` : `Tile ${index + 1}: ${state.startsWith("gem") ? "gem" : "mine"}`}
      disabled={disabled || !hidden}
      onClick={() => onPick(index)}
      whileTap={!disabled && hidden ? { scale: 0.94 } : undefined}
      whileHover={!disabled && hidden ? { y: -2 } : undefined}
      transition={tapTransition}
      className={cn(
        "relative grid aspect-square place-items-center overflow-hidden rounded-[12px] transition-colors duration-200",
        hidden && "bg-elevated hairline enabled:hover:border-hairline-strong disabled:cursor-default",
        state === "gem" && "bg-win/10 ring-1 ring-win/30",
        state === "bust" && "bg-loss",
        (state === "mine" || state === "gem-dim") && "bg-surface hairline",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!hidden && (
          <motion.span
            key={state}
            className="grid size-full place-items-center"
            initial={{ scale: 0.4, opacity: 0, rotateY: 90 }}
            animate={{ scale: 1, opacity: 1, rotateY: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 24, delay }}
          >
            {state === "gem" && <Gem />}
            {state === "gem-dim" && <Gem dim />}
            {state === "bust" && <Mine hit />}
            {state === "mine" && <Mine />}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
