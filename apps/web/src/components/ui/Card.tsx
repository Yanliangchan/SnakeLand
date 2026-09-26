"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";

export interface CardProps extends HTMLMotionProps<"div"> {
  elevated?: boolean;
  padded?: boolean;
}

/** Surface container. Enters with the shared fade-up unless overridden. */
export function Card({ elevated, padded = true, className, ...rest }: CardProps) {
  return (
    <motion.div
      {...fadeUp}
      className={cn(
        "rounded-[var(--radius-card)] hairline",
        elevated ? "bg-elevated" : "bg-surface",
        padded && "p-5 sm:p-6",
        className,
      )}
      {...rest}
    />
  );
}
