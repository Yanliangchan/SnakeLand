"use client";

import { useEffect, useState } from "react";
import type { RewardsStateDTO } from "@snakeland/shared";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { engagementApi } from "@/lib/engagement-api";
import { chips, timeLeft } from "@/lib/format";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";

/** Cashback on today's losses, and a free top-up when nearly broke. */
export function RewardsCard() {
  const { me, setWallet } = useSession();
  const { play } = useSettings();
  const [state, setState] = useState<RewardsStateDTO | null>(null);
  const [busy, setBusy] = useState<"cashback" | "rescue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balance = me?.wallet.balance;

  // Refresh when the balance moves (a game, a claim).
  useEffect(() => {
    let cancelled = false;
    engagementApi
      .rewards()
      .then((s) => !cancelled && setState(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [balance]);

  if (!state) return null;
  const cb = state.cashback;
  const rs = state.rescue;

  const claim = async (kind: "cashback" | "rescue") => {
    setBusy(kind);
    setError(null);
    try {
      const r = kind === "cashback" ? await engagementApi.claimCashback() : await engagementApi.claimRescue();
      setWallet({ balance: r.balance });
      setState(r.rewards);
      play("coin");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't claim");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3.5 hairline sm:px-5",
          cb.available > 0 ? "bg-[color-mix(in_srgb,var(--color-win)_8%,var(--color-surface))]" : "bg-surface",
        )}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">
            {cb.percent}% cashback{cb.available > 0 && <span className="text-win"> · +{chips(cb.available)}</span>}
          </p>
          <p className="truncate text-[12px] text-fg-muted">
            {cb.lossToday > 0
              ? `Down ${chips(cb.lossToday)} today · up to ${chips(cb.cap)} a day`
              : `Get ${cb.percent}% of today's losses back, up to ${chips(cb.cap)}`}
          </p>
        </div>
        <Button size="sm" onClick={() => void claim("cashback")} loading={busy === "cashback"} disabled={cb.available <= 0 || busy !== null}>
          Claim
        </Button>
      </div>
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3.5 hairline sm:px-5",
          rs.canClaim ? "bg-[color-mix(in_srgb,var(--color-gold)_10%,var(--color-surface))]" : "bg-surface",
        )}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Out of chips?</p>
          <p className="truncate text-[12px] text-fg-muted">
            {rs.canClaim
              ? `Take a free ${chips(rs.amount)} top-up`
              : rs.nextAt
                ? `Next top-up in ${timeLeft(rs.nextAt)}`
                : `Free ${chips(rs.amount)} when you're under ${chips(rs.threshold)}`}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void claim("rescue")} loading={busy === "rescue"} disabled={!rs.canClaim || busy !== null}>
          Top up
        </Button>
      </div>
      {error && <p className="text-[12px] text-loss sm:col-span-2">{error}</p>}
    </div>
  );
}
