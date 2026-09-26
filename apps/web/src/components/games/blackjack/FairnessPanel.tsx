"use client";

import { verifyCommit, type RevealedShoeDTO, type ShoeDTO } from "@snakeland/shared";
import { FairnessDialog, FairRow, VerifiedBadge } from "../shared/FairnessDialog";

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
  return (
    <FairnessDialog
      open={open}
      onClose={onClose}
      intro="Each shoe is shuffled from a server seed committed before the first card, mixed with a seed from your browser. The server seed is revealed when the shoe is reshuffled or you leave the table."
    >
      <section className="flex flex-col gap-3">
        <p className="text-[13px] font-medium">Current shoe</p>
        <FairRow label="Server seed hash (commit)" value={shoe.commit} />
        <FairRow label="Client seed" value={shoe.clientSeed} placeholder="Set on the first deal of this shoe" />
      </section>
      {revealed && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">Previous shoe</p>
            <VerifiedBadge ok={verifyCommit(revealed.serverSeed, revealed.commit)} label="Commit verified" />
          </div>
          <FairRow label="Server seed" value={revealed.serverSeed} />
          <FairRow label="Client seed" value={revealed.clientSeed} />
          <FairRow label="Commit" value={revealed.commit} />
          <p className="text-[12px] leading-relaxed text-fg-muted">
            Shoe order = Fisher–Yates shuffle of {revealed.decks} ordered decks using HMAC-SHA256(server seed, “client
            seed:0:n”) floats.
          </p>
        </section>
      )}
    </FairnessDialog>
  );
}
