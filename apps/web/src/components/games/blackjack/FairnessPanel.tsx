"use client";

import { AnimatePresence, motion } from "framer-motion";
import { verifyCommit, type RevealedShoeDTO, type ShoeDTO } from "@snakeland/shared";
import { Button } from "@/components/ui";
import { expoOut } from "@/lib/motion";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <code className="break-all rounded-[8px] bg-bg px-3 py-2 font-mono text-[12px] text-fg hairline">
        {value ?? "Set on the first deal of this shoe"}
      </code>
    </div>
  );
}

/** Commit for the live shoe, and seeds (verified in-browser) for the last revealed one. */
export function FairnessPanel({
  open,
  onClose,
  shoe,
  revealed,
}: {
  open: boolean;
  onClose: () => void;
  shoe: ShoeDTO;
  revealed: RevealedShoeDTO | null;
}) {
  const verified = revealed ? verifyCommit(revealed.serverSeed, revealed.commit) : null;
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
              <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">
                Each shoe is shuffled from a server seed committed before the first card, mixed with a seed from your
                browser. The server seed is revealed when the shoe is reshuffled or you leave the table.
              </p>
            </div>

            <section className="flex flex-col gap-3">
              <p className="text-[13px] font-medium">Current shoe</p>
              <Row label="Server seed hash (commit)" value={shoe.commit} />
              <Row label="Client seed" value={shoe.clientSeed} />
            </section>

            {revealed && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium">Previous shoe</p>
                  <span className={verified ? "text-[12px] text-win" : "text-[12px] text-loss"}>
                    {verified ? "Commit verified" : "Commit mismatch"}
                  </span>
                </div>
                <Row label="Server seed" value={revealed.serverSeed} />
                <Row label="Client seed" value={revealed.clientSeed} />
                <Row label="Commit" value={revealed.commit} />
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  Shoe order = Fisher–Yates shuffle of {revealed.decks} ordered decks using HMAC-SHA256(server seed,
                  “client seed:0:n”) floats.
                </p>
              </section>
            )}

            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
