"use client";

import { motion } from "framer-motion";

export function FullScreenLoader() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="grid min-h-dvh place-items-center"
      aria-busy
      aria-label="Loading"
    >
      <motion.span
        className="size-1.5 rounded-full bg-fg-muted"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
}
