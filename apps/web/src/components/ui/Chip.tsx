"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { chipEnter, chipSpring } from "@/lib/motion";

export const CHIP_VALUES = [10, 50, 100, 500, 1_000, 5_000] as const;
export type ChipValue = (typeof CHIP_VALUES)[number];

/** Grayscale ramp: higher denominations are lighter. No per-game colour. */
const FACE: Record<ChipValue, { bg: string; fg: string }> = {
  10: { bg: "#262626", fg: "#FAFAFA" },
  50: { bg: "#333333", fg: "#FAFAFA" },
  100: { bg: "#4A4A4A", fg: "#FAFAFA" },
  500: { bg: "#8A8A8A", fg: "#0A0A0A" },
  1_000: { bg: "#C8C8C8", fg: "#0A0A0A" },
  5_000: { bg: "#FAFAFA", fg: "#0A0A0A" },
};

export function formatChip(value: number): string {
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

export interface ChipProps {
  /** Stable identity: the same chipId in the tray and on the felt makes Framer Motion fly it across. */
  chipId: string;
  value: ChipValue;
  size?: number;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function Chip({ chipId, value, size = 44, selected, onClick, disabled, className }: ChipProps) {
  const face = FACE[value];
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      layoutId={`chip-${chipId}`}
      initial={chipEnter.initial}
      animate={chipEnter.animate}
      transition={chipSpring}
      whileTap={onClick && !disabled ? { scale: 0.92 } : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      aria-label={`${value} chip`}
      aria-pressed={onClick ? Boolean(selected) : undefined}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full font-semibold tabular select-none",
        onClick && "cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: face.bg,
        color: face.fg,
        fontSize: size * 0.28,
        boxShadow: selected
          ? "0 0 0 2px #0A0A0A, 0 0 0 3.5px #FAFAFA"
          : "inset 0 0 0 1px rgba(255,255,255,0.12), 0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      {/* Edge notches */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[3px] rounded-full"
        style={{
          background: `repeating-conic-gradient(from 0deg, ${face.fg}33 0deg 10deg, transparent 10deg 45deg)`,
          mask: "radial-gradient(circle, transparent 62%, #000 63%)",
          WebkitMask: "radial-gradient(circle, transparent 62%, #000 63%)",
        }}
      />
      <span className="relative">{formatChip(value)}</span>
    </Comp>
  );
}
