import type { Transition, Variants } from "framer-motion";

/**
 * The app's motion vocabulary. Every animated element pulls from here so
 * timings stay identical across games. Nothing appears via a class toggle:
 * use these with initial/animate/exit or a shared layoutId.
 */

/** 1. Button press. */
export const tap = { scale: 0.96 } as const;
export const tapTransition: Transition = { duration: 0.1, ease: "easeInOut" };

/** 2. Balance counter spring. */
export const balanceSpring = { stiffness: 120, damping: 20, mass: 0.5 } as const;

/**
 * 3. Card deal: staggered, expo-out. Use with custom={i}, or with
 * custom={{ i, step, fromShoe }} for a slower deal that slides in from the shoe.
 */
export const expoOut = [0.16, 1, 0.3, 1] as const;
type CardDeal = number | { i: number; step?: number; fromShoe?: boolean };
const dealOf = (c: CardDeal) => (typeof c === "number" ? { i: c } : c);
export const cardVariants: Variants = {
  hidden: (c: CardDeal) =>
    dealOf(c).fromShoe ? { opacity: 0, x: 160, y: -140, rotate: 18, scale: 0.8 } : { opacity: 0, scale: 0.9, y: 8 },
  visible: (c: CardDeal) => {
    const { i, step = 0.07, fromShoe } = dealOf(c);
    return {
      opacity: 1,
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1,
      transition: { duration: fromShoe ? 0.55 : 0.32, ease: expoOut, delay: i * step },
    };
  },
  exit: { opacity: 0, scale: 0.9 },
};

/** 4. Chip placement: shared layoutId between tray and felt. */
export const chipSpring: Transition = { type: "spring", stiffness: 300, damping: 20 };
export const chipEnter = { initial: { scale: 0.6, opacity: 0 }, animate: { scale: 1, opacity: 1 } } as const;

/** 5. Table switch: old table fully exits before new enters (AnimatePresence mode="wait"). */
export const tableSwitch = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
} as const;

/** 6. Win celebration: only for payouts above this multiplier. */
export const CELEBRATE_ABOVE_MULTIPLIER = 2;
export const celebrate: { animate: { scale: number[] }; transition: Transition } = {
  animate: { scale: [1, 1.15, 1] },
  transition: { duration: 0.7, ease: "easeOut", times: [0, 0.4, 1] },
};

/** Generic enter/exit for panels, messages and page content. */
export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.24, ease: expoOut },
} as const;

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18 },
} as const;
