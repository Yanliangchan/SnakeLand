"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CRASH_LIMITS,
  crashPayout,
  crashPointX100,
  verifyCommit,
  type CrashMyBetDTO,
  type CrashRoundDTO,
  type CrashSettlementDTO,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, Toggle, WinCelebration } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { crashApi, useCrashSocket } from "@/lib/crash-api";
import { fadeUp, tap, tapTransition } from "@/lib/motion";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { ChipTray, StakeSummary, useChipSlip } from "../shared/ChipSlip";
import { FairnessDialog, FairRow, VerifiedBadge } from "../shared/FairnessDialog";
import { CrashStage, liveMultiplier } from "./CrashStage";

const AUTO_PRESETS = [1.5, 2, 3, 5, 10];

function message(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "INSUFFICIENT_FUNDS") return "Not enough chips for that.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

function PointPill({ x100 }: { x100: number }) {
  const v = x100 / 100;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular hairline",
        v >= 10 ? "border-gold/40 text-gold" : v >= 2 ? "text-win" : "text-fg-muted",
      )}
    >
      {v.toFixed(2)}×
    </span>
  );
}

/** Live "Cash out 1,234" label, updated per frame without re-rendering the page. */
function LivePayout({ round, amount, offsetMs }: { round: CrashRoundDTO; amount: number; offsetMs: React.RefObject<number> }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const { m } = liveMultiplier(round, Date.now() + (offsetMs.current ?? 0));
      if (el.current) el.current.textContent = crashPayout(amount, Math.floor(m * 100)).toLocaleString();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [round, amount, offsetMs]);
  return <span ref={el} className="tabular" />;
}

export function CrashGame() {
  const { me, setWallet } = useSession();
  const { play, haptic } = useSettings();
  const balance = me?.wallet.balance ?? 0;
  const slip = useChipSlip(Math.min(CRASH_LIMITS.maxBet, balance));
  const [autoOn, setAutoOn] = useState(false);
  const [autoX, setAutoX] = useState("2.00");
  const [myBet, setMyBet] = useState<CrashMyBetDTO | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CrashSettlementDTO | null>(null);
  const [fairOpen, setFairOpen] = useState(false);
  const busy = useRef(false);

  const onSettled = useCallback(
    (s: CrashSettlementDTO) => {
      setResult(s);
      setWallet({ balance: s.balance });
      recordRound("crash", s.staked, s.payout);
      setMyBet((b) => (b && b.roundId === s.roundId ? { ...b, payout: s.payout, cashoutX100: s.cashoutX100 } : b));
      if (s.payout === 0) haptic("lose");
    },
    [setWallet, haptic],
  );
  const onAutoCashout = useCallback(
    (bet: CrashMyBetDTO, bal: number) => {
      setMyBet(bet);
      setWallet({ balance: bal });
      play("chime");
    },
    [setWallet, play],
  );
  // A queued bet goes in as soon as the next round opens for betting.
  const queuedRef = useRef(false);
  const placeRef = useRef<(r: CrashRoundDTO) => void>(() => {});
  const onState = useCallback((s: { round: CrashRoundDTO | null }) => {
    if (queuedRef.current && s.round?.phase === "betting") {
      queuedRef.current = false;
      setQueued(false);
      placeRef.current(s.round);
    }
  }, []);
  const { state, setState, connected, offsetMs } = useCrashSocket({ onSettled, onAutoCashout, onState });
  const round = state?.round ?? null;

  // Initial snapshot (with my bet), then the socket keeps it live.
  useEffect(() => {
    let cancelled = false;
    crashApi
      .state()
      .then((r) => {
        if (cancelled) return;
        offsetMs.current = new Date(r.serverNow).getTime() - Date.now();
        setState((s) => s ?? r.state);
        setMyBet(r.myBet);
      })
      .catch(() => !cancelled && setError("Couldn't load the round"));
    return () => {
      cancelled = true;
    };
  }, [offsetMs, setState]);

  // Forget the previous round's bet once a new round opens.
  const roundId = round?.id;
  const myBetForRound = myBet && myBet.roundId === roundId ? myBet : null;

  const autoX100 = autoOn ? Math.round(Number(autoX) * 100) : null;
  const autoValid = autoX100 === null || (Number.isFinite(autoX100) && autoX100 >= CRASH_LIMITS.minAutoX100 && autoX100 <= CRASH_LIMITS.maxAutoX100);

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  const placeBet = useCallback(
    (r: CrashRoundDTO) =>
      run(async () => {
        const res = await crashApi.bet({ roundId: r.id, amount: slip.amount, autoCashoutX100: autoX100 });
        setMyBet(res.myBet);
        setWallet({ balance: res.balance });
        setResult(null);
        play("click");
      }),
    [run, slip.amount, autoX100, setWallet, play],
  );

  useEffect(() => {
    placeRef.current = (r) => void placeBet(r);
    queuedRef.current = queued;
  });

  const canBet = slip.amount >= CRASH_LIMITS.minBet && autoValid;
  const inFlight = round?.phase === "running";
  const active = myBetForRound && myBetForRound.cashoutX100 === null && myBetForRound.payout === null;

  const main = useCallback(() => {
    if (!round || pending) return;
    if (round.phase === "betting") {
      if (myBetForRound) {
        void run(async () => {
          const res = await crashApi.cancel(round.id);
          setMyBet(null);
          setWallet({ balance: res.balance });
        });
      } else if (canBet) void placeBet(round);
      return;
    }
    if (round.phase === "running" && active) {
      void run(async () => {
        const res = await crashApi.cashout(round.id);
        setMyBet(res.myBet);
        setWallet({ balance: res.balance });
        play("chime");
      });
      return;
    }
    if (canBet) setQueued((q) => !q);
  }, [round, pending, myBetForRound, canBet, placeBet, run, setWallet, active, play]);

  // Space / Enter: bet, cancel, cash out, or queue for the next round.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        main();
      } else if (e.key.toLowerCase() === "a") {
        setAutoOn((on) => !on);
      }
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const limit = Math.min(CRASH_LIMITS.maxBet, balance);
  const lastCrashed = round?.phase === "crashed" ? round : null;
  const fairOk = lastCrashed?.serverSeed ? verifyCommit(lastCrashed.serverSeed, lastCrashed.commit) : null;
  const pointOk = lastCrashed?.serverSeed ? crashPointX100(lastCrashed.serverSeed, lastCrashed.id) === lastCrashed.crashX100 : null;

  let label: React.ReactNode = "Bet";
  let variant: "primary" | "secondary" = "primary";
  if (!round) label = "Connecting…";
  else if (round.phase === "betting") {
    if (myBetForRound) {
      label = "Cancel bet";
      variant = "secondary";
    } else label = `Bet ${slip.amount.toLocaleString()}`;
  } else if (round.phase === "running" && active) {
    label = (
      <>
        Cash out <LivePayout round={round} amount={myBetForRound!.amount} offsetMs={offsetMs} />
      </>
    );
  } else {
    label = queued ? "Queued · tap to cancel" : "Bet next round";
    variant = queued ? "secondary" : "primary";
  }
  const disabled =
    !round || (round.phase === "betting" && !myBetForRound && !canBet) || (!active && round.phase !== "betting" && !canBet && !queued);

  const cashed = myBetForRound?.cashoutX100 ?? null;

  return (
    <>
      <GameShell
        game="crash"
        title="Crash"
        tableId="crash"
        controls={
          <div className="flex flex-col gap-4">
            <AnimatePresence>
              {error && (
                <motion.p {...fadeUp} role="alert" className="text-center text-[13px] text-loss">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:gap-6">
              <PanelSection label="Bet" className="flex flex-col gap-2 @4xl:min-w-72 @4xl:flex-1">
                <StakeSummary slip={slip} limit={limit} disabled={Boolean(myBetForRound) && !cashed} />
                <ChipTray slip={slip} disabled={Boolean(myBetForRound) && !cashed} />
              </PanelSection>
              <PanelSection label="Auto cash-out" className="@4xl:w-64">
                <div className="flex items-center gap-2">
                  <Toggle label="Auto cash-out" checked={autoOn} onChange={setAutoOn} />
                  <div className={cn("flex h-9 flex-1 items-center rounded-[var(--radius-ui)] bg-bg px-3 hairline", !autoOn && "opacity-50")}>
                    <input
                      inputMode="decimal"
                      value={autoX}
                      disabled={!autoOn}
                      onChange={(e) => setAutoX(e.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
                      onBlur={() => {
                        const v = Number(autoX);
                        setAutoX(Number.isFinite(v) && v >= 1.01 ? v.toFixed(2) : "2.00");
                      }}
                      aria-label="Auto cash-out multiplier"
                      className="w-full min-w-0 bg-transparent text-[15px] font-semibold tabular outline-none"
                    />
                    <span className="text-[13px] text-fg-muted">×</span>
                  </div>
                </div>
                <div className="mt-2 flex gap-1.5">
                  {AUTO_PRESETS.map((p) => (
                    <motion.button
                      key={p}
                      whileTap={tap}
                      transition={tapTransition}
                      onClick={() => {
                        setAutoOn(true);
                        setAutoX(p.toFixed(2));
                      }}
                      className={cn(
                        "h-7 flex-1 rounded-[8px] text-[12px] font-medium transition-colors hairline",
                        autoOn && Number(autoX) === p ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {p}×
                    </motion.button>
                  ))}
                </div>
                {!autoValid && <p className="mt-1 text-[12px] text-loss">Between 1.01× and 10,000×</p>}
              </PanelSection>
              <div className="@4xl:w-56">
                <WinCelebration trigger={cashed ? `${roundId}:${cashed}` : null} multiplier={(cashed ?? 0) / 100}>
                  <Button size="lg" block variant={variant} onClick={main} loading={pending} disabled={disabled}>
                    {label}
                  </Button>
                </WinCelebration>
                <p className="mt-2 h-4 text-center text-[12px] text-fg-muted tabular">
                  {myBetForRound
                    ? cashed
                      ? `Cashed out at ${(cashed / 100).toFixed(2)}× · +${(myBetForRound.payout ?? 0).toLocaleString()}`
                      : `In for ${myBetForRound.amount.toLocaleString()}${myBetForRound.autoCashoutX100 ? ` · auto ${(myBetForRound.autoCashoutX100 / 100).toFixed(2)}×` : ""}`
                    : inFlight
                      ? "Round in flight. Bets open next round."
                      : ""}
                </p>
              </div>
            </div>

            {state && state.bets.length > 0 && (
              <PanelSection label={`Players · ${state.players}`} className="hidden lg:block">
                <ul className="max-h-56 divide-y divide-hairline overflow-y-auto text-[13px]">
                  {state.bets.map((b, i) => (
                    <li key={`${b.name}-${i}`} className="flex items-center justify-between gap-2 py-1.5">
                      <span className={cn("truncate", b.isMe && "text-fg")}>{b.isMe ? "You" : b.name}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular">
                        <span className="text-fg-muted">{b.amount.toLocaleString()}</span>
                        {b.cashoutX100 !== null ? (
                          <span className="text-win">{(b.cashoutX100 / 100).toFixed(2)}×</span>
                        ) : round?.phase === "crashed" ? (
                          <span className="text-loss">bust</span>
                        ) : (
                          <span className="text-fg-disabled">—</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </PanelSection>
            )}
          </div>
        }
      >
        <div className="flex h-full flex-col gap-2 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 gap-1.5 overflow-hidden [mask-image:linear-gradient(90deg,#000_85%,transparent)]">
              {(state?.recent ?? []).map((x, i) => (
                <PointPill key={`${i}-${x}`} x100={x} />
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!connected && <span className="text-[12px] text-fg-muted">Reconnecting…</span>}
              <span className="hidden text-[12px] text-fg-muted tabular sm:inline">
                {state ? `${state.players} in · ${state.totalStaked.toLocaleString()}` : ""}
              </span>
              <button
                onClick={() => setFairOpen(true)}
                className="rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
              >
                Fair
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-bg/40 hairline">
            <CrashStage round={round} offsetMs={offsetMs} bets={state?.bets ?? []} myCashoutX100={cashed} />
            <AnimatePresence>
              {result && round?.phase === "crashed" && result.roundId === round.id && (
                <motion.div
                  {...fadeUp}
                  className={cn(
                    "absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface px-4 py-1.5 text-[13px] font-medium tabular hairline",
                    result.payout > 0 ? "text-win" : "text-loss",
                  )}
                >
                  {result.payout > 0
                    ? `+${(result.payout - result.staked).toLocaleString()} at ${((result.cashoutX100 ?? 0) / 100).toFixed(2)}×`
                    : `−${result.staked.toLocaleString()}`}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </GameShell>

      <FairnessDialog
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        intro="Each round's crash point is fixed before betting opens. We publish a hash of the secret seed first and reveal the seed after the crash, so you can check we didn't change it."
      >
        <FairRow label="This round's commit (sha256 of the server seed)" value={round?.commit ?? null} />
        {lastCrashed ? (
          <>
            <FairRow label="Revealed server seed" value={lastCrashed.serverSeed} />
            <FairRow label="Round id (the HMAC message)" value={lastCrashed.id} />
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-fg-muted">Commit matches seed</span>
              <VerifiedBadge ok={Boolean(fairOk)} />
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-fg-muted">Crash point {((lastCrashed.crashX100 ?? 0) / 100).toFixed(2)}× recomputed</span>
              <VerifiedBadge ok={Boolean(pointOk)} />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-fg-muted">The seed is revealed the moment this round crashes.</p>
        )}
        <p className="text-[12px] leading-relaxed text-fg-muted">
          Crash point = 0.99 ÷ (1 − r), where r is the first fair float from HMAC-SHA256(seed, round id). Any cash-out target
          returns 99% on average.
        </p>
      </FairnessDialog>
    </>
  );
}
