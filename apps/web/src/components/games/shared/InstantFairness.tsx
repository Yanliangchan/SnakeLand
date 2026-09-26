"use client";

import { useState } from "react";
import { verifyCommit, type FairRevealDTO } from "@snakeland/shared";
import { Button } from "@/components/ui";
import { FairnessDialog, FairRow, VerifiedBadge } from "./FairnessDialog";
import type { useClientSeed } from "./useClientSeed";

/**
 * Fairness for per-round games: the next round's commit, the player's client
 * seed (random per round, or pinned), and the last round's revealed seeds,
 * with the commit and the outcome re-checked in the browser.
 */
export function InstantFairness({
  open,
  onClose,
  nextCommit,
  clientSeed,
  last,
  outcomeLabel,
  outcomeOk,
}: {
  open: boolean;
  onClose: () => void;
  nextCommit: string | null;
  clientSeed: ReturnType<typeof useClientSeed>;
  last: FairRevealDTO | null;
  outcomeLabel: string;
  /** Whether recomputing the outcome from the revealed seeds matched. */
  outcomeOk: boolean | null;
}) {
  const [draft, setDraft] = useState(clientSeed.custom ?? "");
  const valid = draft === "" || clientSeed.isValid(draft);

  return (
    <FairnessDialog
      open={open}
      onClose={onClose}
      intro="Before you bet, the server commits to a secret seed by showing its hash. Your round mixes that seed with your client seed, and the seed is revealed the moment the round ends."
    >
      <section className="flex flex-col gap-3">
        <p className="text-[13px] font-medium">Next round</p>
        <FairRow label="Server seed hash (commit)" value={nextCommit} />
        <div className="flex flex-col gap-1">
          <label htmlFor="client-seed" className="text-[12px] text-fg-muted">
            Client seed
          </label>
          <div className="flex gap-2">
            <input
              id="client-seed"
              value={draft}
              onChange={(e) => setDraft(e.target.value.trim())}
              maxLength={64}
              placeholder="Random every round"
              aria-invalid={!valid || undefined}
              className="h-10 min-w-0 flex-1 rounded-[8px] bg-bg px-3 font-mono text-[12px] text-fg outline-none hairline placeholder:text-fg-disabled focus:border-hairline-strong"
            />
            <Button size="sm" variant="secondary" disabled={!valid} onClick={() => clientSeed.setCustom(draft || null)}>
              Save
            </Button>
          </div>
          <span className={valid ? "text-[12px] text-fg-disabled" : "text-[12px] text-loss"}>
            {valid ? "Letters, digits, _ and -. Leave empty for a random seed each round." : "Use letters, digits, _ or -"}
          </span>
        </div>
      </section>

      {last && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">Last round</p>
            <div className="flex gap-3">
              <VerifiedBadge ok={verifyCommit(last.serverSeed, last.commit)} label="Commit verified" />
              {outcomeOk !== null && <VerifiedBadge ok={outcomeOk} label={outcomeLabel} />}
            </div>
          </div>
          <FairRow label="Server seed" value={last.serverSeed} />
          <FairRow label="Client seed" value={last.clientSeed} />
          <FairRow label="Commit" value={last.commit} />
        </section>
      )}
    </FairnessDialog>
  );
}
