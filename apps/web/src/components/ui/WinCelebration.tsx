"use client";

import { motion, useAnimationControls } from "framer-motion";
import { useEffect } from "react";
import { CELEBRATE_ABOVE_MULTIPLIER, celebrate } from "@/lib/motion";
import { useSettings } from "@/providers/settings";

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
    if (multiplier > 1) play("chime");
    if (multiplier > CELEBRATE_ABOVE_MULTIPLIER) void controls.start(celebrate.animate, celebrate.transition);
    // Only fire when a new result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return (
    <motion.div animate={controls} className={className}>
      {children}
    </motion.div>
  );
}
