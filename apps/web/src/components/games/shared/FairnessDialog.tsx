"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui";
import { expoOut } from "@/lib/motion";

export function FairRow({ label, value, placeholder }: { label: string; value: string | null; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <code className="break-all rounded-[8px] bg-bg px-3 py-2 font-mono text-[12px] text-fg hairline">
        {value ?? placeholder ?? "—"}
      </code>
    </div>
  );
}

export function VerifiedBadge({ ok, label = "Verified" }: { ok: boolean; label?: string }) {
  return <span className={ok ? "text-[12px] text-win" : "text-[12px] text-loss"}>{ok ? label : "Mismatch"}</span>;
}

/** Bottom sheet on mobile, centred dialog on desktop. */
export function FairnessDialog({
  open,
  onClose,
  intro,
  children,
}: {
  open: boolean;
  onClose: () => void;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Provably fair"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.32, ease: expoOut }}
            onClick={(e) => e.stopPropagation()}
            className="m-3 flex max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-md flex-col gap-5 overflow-y-auto rounded-[var(--radius-card)] bg-surface p-6 hairline"
          >
            <div>
              <h2 className="text-[20px] font-semibold">Provably fair</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{intro}</p>
            </div>
            {children}
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
