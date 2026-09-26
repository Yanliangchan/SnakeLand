"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  INSTANT_BET_LIMITS,
  PLINKO_RISKS,
  PLINKO_ROWS_MAX,
  PLINKO_ROWS_MIN,
  PLINKO_TABLES,
  formatX100,
  plinkoPath,
  type PlinkoDropDTO,
  type PlinkoRisk,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, Toggle, WinCelebration } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { plinkoApi } from "@/lib/instant-api";
import { fadeUp, tap, tapTransition } from "@/lib/motion";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { ChipTray, StakeSummary, useChipSlip } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { RecentMultipliers, type RecentItem } from "../shared/RecentMultipliers";
import { useClientSeed } from "../shared/useClientSeed";
import { Board, type Ball } from "./Board";

const RISK_LABEL: Record<PlinkoRisk, string> = { low: "Low", medium: "Med", high: "High" };
const MAX_IN_FLIGHT = 12;
const AUTO_INTERVAL_MS = 350;

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-9 rounded-[10px] p-0.5 hairline" role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={o === value}
          disabled={disabled}
          onClick={() => onChange(o)}
          className={cn(
            "relative h-8 min-w-12 flex-1 rounded-[8px] px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40",
            o === value ? "text-bg" : "text-fg-muted hover:text-fg",
          )}
        >
          {o === value && (
            <motion.span
              layoutId="risk-pill"
              className="absolute inset-0 rounded-[8px] bg-fg"
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
            />
          )}
          <span className="relative">{label(o)}</span>
        </button>
      ))}
    </div>
  );
}

export function PlinkoGame() {
  const { me, setWallet } = useSession();
  const { play } = useSettings();
  const clientSeed = useClientSeed();
  const balance = me?.wallet.balance ?? 0;
  const slip = useChipSlip(Math.min(INSTANT_BET_LIMITS.max, balance));

  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [balls, setBalls] = useState<Ball[]>([]);
  const [hits, setHits] = useState<number[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [last, setLast] = useState<PlinkoDropDTO | null>(null);
  const [nextCommit, setNextCommit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [fairOpen, setFairOpen] = useState(false);
  const [queued, setQueued] = useState(0);

  // Payouts are shown only when their ball lands: displayed = server − pending payouts.
  const serverBalance = useRef<number | null>(null);
  const pendingPayout = useRef(new Map<string, number>());
  const drops = useRef(new Map<string, PlinkoDropDTO>());
  const sending = useRef(false);
  const queue = useRef(0);

  const syncBalance = useCallback(() => {
    if (serverBalance.current === null) return;
    let pending = 0;
    for (const v of pendingPayout.current.values()) pending += v;
    setWallet({ balance: serverBalance.current - pending });
  }, [setWallet]);

  useEffect(() => {
    let cancelled = false;
    plinkoApi.state().then((s) => !cancelled && setNextCommit(s.nextCommit)).catch(() => {});
    const pending = pendingPayout.current;
    return () => {
      cancelled = true;
      // Leaving mid-flight: settle the display to the real balance.
      pending.clear();
      if (serverBalance.current !== null) setWallet({ balance: serverBalance.current });
    };
  }, [setWallet]);

  const table = PLINKO_TABLES[risk][rows]!;
  const inFlight = balls.length > 0 || queued > 0;

  // Latest config for the send loop without restarting it.
  const config = useRef({ bet: slip.amount, rows, risk });
  useEffect(() => {
    config.current = { bet: slip.amount, rows, risk };
  });

  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current > 0) {
        const { bet, rows, risk } = config.current;
        try {
          const res = await plinkoApi.drop({ bet, rows, risk, clientSeed: clientSeed.next() });
          serverBalance.current = res.balance;
          pendingPayout.current.set(res.drop.id, res.drop.payout);
          drops.current.set(res.drop.id, res.drop);
          syncBalance();
          setNextCommit(res.nextCommit);
          setBalls((b) => [...b, { id: res.drop.id, path: res.drop.path }]);
        } catch (e) {
          setError(message(e));
          setAuto(false);
          queue.current = 0;
        }
        queue.current = Math.max(0, queue.current - 1);
        setQueued(queue.current);
      }
    } finally {
      sending.current = false;
    }
  }, [clientSeed, syncBalance]);

  const drop = useCallback(() => {
    if (config.current.bet < INSTANT_BET_LIMITS.min) {
      setError(`Minimum bet is ${INSTANT_BET_LIMITS.min}.`);
      return;
    }
    if (queue.current + balls.length >= MAX_IN_FLIGHT) return;
    setError(null);
    queue.current += 1;
    setQueued(queue.current);
    void pump();
  }, [balls.length, pump]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(drop, AUTO_INTERVAL_MS);
    return () => clearInterval(t);
  }, [auto, drop]);

  const land = useCallback(
    (id: string) => {
      const d = drops.current.get(id);
      drops.current.delete(id);
      pendingPayout.current.delete(id);
      syncBalance();
      setBalls((b) => b.filter((x) => x.id !== id));
      if (!d) return;
      recordRound("plinko", d.bet, d.payout);
      play(d.multiplierX100 > 100 ? "chime" : "click");
      setHits((h) => {
        const next = [...h];
        next[d.bucket] = (next[d.bucket] ?? 0) + 1;
        return next;
      });
      setRecent((r) => [{ id: d.id, x100: d.multiplierX100 }, ...r].slice(0, 12));
      setLast(d);
    },
    [play, syncBalance],
  );

  // Space or Enter drops a ball.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        drop();
      }
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const outcomeOk = last
    ? JSON.stringify(plinkoPath(last.reveal.serverSeed, last.reveal.clientSeed, last.rows).path) === JSON.stringify(last.path)
    : null;
  const limit = Math.min(INSTANT_BET_LIMITS.max, balance);

  return (
    <>
      <GameShell
        game="plinko"
        title="Plinko"
        tableId="plinko"
        controls={
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {error && (
                <motion.p {...fadeUp} role="alert" className="text-center text-[13px] text-loss">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:gap-6">
              <PanelSection label="Bet" className="flex flex-col gap-2 @4xl:min-w-72 @4xl:flex-1">
                <StakeSummary slip={slip} limit={limit} disabled={auto} />
                <ChipTray slip={slip} disabled={auto} />
              </PanelSection>
              <div className="grid grid-cols-[1fr_auto] gap-3 @4xl:flex @4xl:gap-6">
                <PanelSection label="Risk">
                  <Segmented options={PLINKO_RISKS} value={risk} onChange={setRisk} label={(r) => RISK_LABEL[r]} disabled={inFlight} />
                </PanelSection>
                <PanelSection label="Rows">
                  <div className="flex h-9 items-center gap-1">
                    <motion.button
                      whileTap={tap}
                      transition={tapTransition}
                      disabled={inFlight || rows <= PLINKO_ROWS_MIN}
                      onClick={() => setRows((r) => r - 1)}
                      aria-label="Fewer rows"
                      className="grid size-8 place-items-center rounded-[8px] text-fg-muted hairline hover:text-fg disabled:opacity-40"
                    >
                      −
                    </motion.button>
                    <span className="w-8 text-center text-[15px] font-semibold tabular">{rows}</span>
                    <motion.button
                      whileTap={tap}
                      transition={tapTransition}
                      disabled={inFlight || rows >= PLINKO_ROWS_MAX}
                      onClick={() => setRows((r) => r + 1)}
                      aria-label="More rows"
                      className="grid size-8 place-items-center rounded-[8px] text-fg-muted hairline hover:text-fg disabled:opacity-40"
                    >
                      +
                    </motion.button>
                  </div>
                </PanelSection>
              </div>
              <div className="flex items-center gap-3 @4xl:w-56">
                <label className="flex items-center gap-2 text-[13px] text-fg-muted">
                  Auto
                  <Toggle
                    label="Auto drop"
                    checked={auto}
                    onChange={(on) => (on && slip.amount < INSTANT_BET_LIMITS.min ? setError(`Minimum bet is ${INSTANT_BET_LIMITS.min}.`) : setAuto(on))}
                  />
                </label>
                <Button size="lg" className="flex-1" onClick={drop} disabled={auto || slip.amount < INSTANT_BET_LIMITS.min}>
                  Drop
                </Button>
              </div>
            </div>
          </div>
        }
      >
        <div
          className="mx-auto flex h-full w-[var(--board)] flex-col justify-center gap-2 py-3 sm:gap-3"
          style={{ "--board": "min(100cqw - 24px, (100cqh - 110px) * 1.18, 760px)" } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-3">
            <RecentMultipliers items={recent} />
            <button
              onClick={() => setFairOpen(true)}
              className="shrink-0 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
            >
              Fair
            </button>
          </div>
          <div className="flex h-10 items-center justify-center">
            <AnimatePresence mode="popLayout" initial={false}>
              {last && (
                <motion.div key={last.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                  <WinCelebration trigger={last.id} multiplier={last.multiplierX100 / 100}>
                    <span
                      className={cn(
                        "text-[28px] font-semibold tracking-[-0.03em] tabular",
                        last.multiplierX100 > 100 ? "text-win" : last.multiplierX100 < 100 ? "text-loss" : "text-fg-muted",
                      )}
                    >
                      {formatX100(last.multiplierX100)}
                    </span>
                  </WinCelebration>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Board rows={rows} table={table} balls={balls} hits={hits} onLand={land} />
        </div>
      </GameShell>
      <InstantFairness
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        nextCommit={nextCommit}
        clientSeed={clientSeed}
        last={last?.reveal ?? null}
        outcomeLabel="Path verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
