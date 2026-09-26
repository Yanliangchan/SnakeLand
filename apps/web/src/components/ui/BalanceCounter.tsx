"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { balanceSpring } from "@/lib/motion";

/** Glides to the new value on every change; never a hard number swap. */
export function BalanceCounter({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, balanceSpring);
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return (
    <motion.span className={cn("tabular", className)} aria-live="polite" aria-label={`${value.toLocaleString()} chips`}>
      {display}
    </motion.span>
  );
}
