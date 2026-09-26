"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { expoOut } from "@/lib/motion";

/** Bottom sheet on phones, centred dialog from `sm`. Escape or the scrim closes it. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.3, ease: expoOut }}
            onClick={(e) => e.stopPropagation()}
            className="m-3 flex max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-md flex-col overflow-y-auto rounded-[var(--radius-card)] bg-surface p-5 hairline sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">{title}</div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hairline hover:text-fg"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
