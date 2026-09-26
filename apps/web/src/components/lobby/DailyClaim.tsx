"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DAILY_CLAIM_AMOUNT, type ClaimTerms, type WalletDTO } from "@snakeland/shared";
import { Button, Card } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";

function useCountdown(target: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export function DailyClaim() {
  const { me, setWallet } = useSession();
  const { play } = useSettings();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countdown = useCountdown(me?.wallet.nextDailyClaimAt ?? null);
  const [terms, setTerms] = useState<ClaimTerms | null>(null);
  const userId = me?.user.id;

  // Perks (weekly rank, top-5 streak) change what the next claim pays.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api<ClaimTerms>("/v1/wallet/claim-terms")
      .then((t) => !cancelled && setTerms(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, me?.wallet.nextDailyClaimAt]);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const res = await api<WalletDTO>("/v1/wallet/daily-claim", { method: "POST", body: {} });
      setWallet({ balance: res.balance, nextDailyClaimAt: res.nextDailyClaimAt });
      play("chime");
    } catch (e) {
      if (e instanceof ApiError && e.code === "DAILY_CLAIM_NOT_READY") {
        const next = (e.body as { error?: { nextDailyClaimAt?: string } })?.error?.nextDailyClaimAt;
        if (next) setWallet({ nextDailyClaimAt: next });
      } else {
        setError(e instanceof Error ? e.message : "Couldn't claim right now");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex h-full items-center justify-between gap-4 md:flex-col md:items-stretch">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Daily chips</p>
        <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular">
          +{(terms?.amount ?? DAILY_CLAIM_AMOUNT).toLocaleString()}
        </p>
        {terms && terms.reasons.length > 0 && (
          <p className="mt-0.5 text-[12px] text-gold">{terms.reasons.join(" · ")}</p>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={countdown ? "wait" : "ready"} {...fadeUp} className="mt-1 text-[13px] text-fg-muted tabular">
            {countdown ? `Next in ${countdown}` : "Free chips, ready to claim"}
          </motion.p>
        </AnimatePresence>
        <AnimatePresence>
          {error && (
            <motion.p {...fadeUp} role="alert" className="mt-1 text-[13px] text-loss">
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <Button size="lg" className="md:w-full" variant={countdown ? "secondary" : "primary"} disabled={Boolean(countdown)} loading={pending} onClick={claim}>
        Claim
      </Button>
    </Card>
  );
}
