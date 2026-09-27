"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { GAMES, type TransactionDTO, type TransactionPageDTO, type TransactionType } from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { DailyClaim } from "@/components/lobby/DailyClaim";
import { BalanceCounter, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { expoOut, fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";

const LABEL: Record<TransactionType, string> = {
  signup_bonus: "Welcome chips",
  daily_claim: "Daily chips",
  bet: "Bet",
  payout: "Payout",
  refund: "Refund",
  guest_merge: "Carried over from guest",
  admin_adjust: "Adjustment",
  lab_reward: "Lab reward",
  bonus_spin: "Bonus wheel",
  referral: "Invite bonus",
  tip: "Tip",
  rain: "Chat rain",
  lab_track: "Lab track bonus",
  event_entry: "Event buy-in",
  event_prize: "Event prize",
  event_refund: "Event refund",
};

const timeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Row({ tx, i }: { tx: TransactionDTO; i: number }) {
  const positive = tx.amount > 0;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: expoOut, delay: Math.min(i, 10) * 0.02 } }}
      className="flex items-center justify-between py-4"
    >
      <div>
        <p className="text-[15px]">
          {LABEL[tx.type]}
          {tx.game && <span className="text-fg-muted"> · {GAMES[tx.game].name}</span>}
        </p>
        <p className="mt-0.5 text-[12px] text-fg-muted tabular">{timeFmt.format(new Date(tx.createdAt))}</p>
      </div>
      <div className="text-right tabular">
        <p className={cn("text-[15px] font-medium", positive && tx.type !== "guest_merge" ? "text-win" : "text-fg")}>
          {positive ? "+" : "−"}
          {Math.abs(tx.amount).toLocaleString()}
        </p>
        <p className="mt-0.5 text-[12px] text-fg-muted">{tx.balanceAfter.toLocaleString()}</p>
      </div>
    </motion.li>
  );
}

export function WalletView() {
  const { me } = useSession();
  const balance = me?.wallet.balance;
  const [items, setItems] = useState<TransactionDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    (after: string | null) =>
      api<TransactionPageDTO>(`/v1/wallet/transactions?limit=25${after ? `&cursor=${encodeURIComponent(after)}` : ""}`),
    [],
  );

  // (Re)load the first page on mount and whenever the balance changes (e.g. after a claim).
  useEffect(() => {
    let cancelled = false;
    fetchPage(null)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, balance]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await fetchPage(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load history");
    } finally {
      setLoading(false);
    }
  }

  if (!me) return null;
  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-12 sm:px-6">
        <motion.section {...fadeUp}>
          <p className="text-[14px] text-fg-muted">Balance</p>
          <h1 className="mt-2 text-[48px] font-semibold leading-none tracking-[-0.035em]">
            <BalanceCounter value={me.wallet.balance} />
          </h1>
        </motion.section>

        <div className="mt-8">
          <DailyClaim />
        </div>

        <h2 className="mt-12 text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">History</h2>
        <Card className="mt-4 py-1 sm:py-1">
          <ul className="divide-y divide-hairline">
            {items.map((tx, i) => (
              <Row key={tx.id} tx={tx} i={i} />
            ))}
          </ul>
          <AnimatePresence>
            {!loading && items.length === 0 && !error && (
              <motion.p {...fadeUp} className="py-8 text-center text-[14px] text-fg-muted">
                No activity yet.
              </motion.p>
            )}
            {error && (
              <motion.p {...fadeUp} role="alert" className="py-6 text-center text-[14px] text-loss">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </Card>
        <AnimatePresence>
          {cursor && (
            <motion.div {...fadeUp} className="mt-4 flex justify-center">
              <Button variant="secondary" loading={loading} onClick={loadMore}>
                Load more
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
