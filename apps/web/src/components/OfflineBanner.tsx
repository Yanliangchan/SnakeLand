"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useSyncExternalStore } from "react";
import { expoOut } from "@/lib/motion";

const subscribe = (l: () => void) => {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
};

/** Pinned notice while the device is offline; games reconnect by themselves when it's back. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          role="status"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.3, ease: expoOut }}
          className="fixed inset-x-0 top-0 z-[60] flex justify-center p-2"
        >
          <span className="flex items-center gap-2 rounded-full bg-elevated px-4 py-1.5 text-[13px] shadow-lg shadow-black/40 hairline">
            <span className="size-1.5 rounded-full bg-loss" />
            You’re offline. We’ll reconnect when you’re back.
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
