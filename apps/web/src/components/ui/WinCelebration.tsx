"use client";

import { motion, useAnimationControls } from "framer-motion";
import { useEffect } from "react";
import { CELEBRATE_ABOVE_MULTIPLIER, celebrate } from "@/lib/motion";
import { useSettings } from "@/providers/settings";
import { Confetti } from "./Confetti";

/**
 * Pulses its children once per `trigger` change, but only when the payout
 * multiplier beats the threshold. Small wins stay quiet on purpose.
 */
export function WinCelebration({
  trigger,
  multiplier,
  children,
  className,
}: {
  trigger: string | number | null;
  multiplier: number;
  children: React.ReactNode;
  className?: string;
}) {
  const controls = useAnimationControls();
  const { play } = useSettings();

  useEffect(() => {
    if (trigger === null) return;
    if (multiplier > 1) play(multiplier >= 10 ? "bigwin" : "win");
    if (multiplier > CELEBRATE_ABOVE_MULTIPLIER) void controls.start(celebrate.animate, celebrate.transition);
    // Only fire when a new result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Confetti keys off the trigger during render (no effect state), sized by the multiplier.
  const celebrating = trigger !== null && multiplier > CELEBRATE_ABOVE_MULTIPLIER;

  return (
    <motion.div animate={controls} className={className}>
      <Confetti fire={celebrating ? trigger : null} intensity={Math.min(3, 0.7 + Math.log2(Math.max(1, multiplier)) / 2)} />
      {children}
    </motion.div>
  );
}
