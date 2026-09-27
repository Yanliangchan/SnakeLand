"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROULETTE_LIMITS,
  ROULETTE_WHEELS,
  pocketColor,
  rouletteResult,
  verifyCommit,
  type RouletteMyBetsDTO,
  type RouletteSettlementDTO,
  type WheelId,
  rouletteRoom,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, WinCelebration } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { rouletteApi, useRouletteSocket } from "@/lib/roulette-api";
import { useMedia } from "@/lib/use-media";
import { fade, fadeUp } from "@/lib/motion";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { FairnessDialog, FairRow, VerifiedBadge } from "../shared/FairnessDialog";
import { ChipSelector, useSpotChips } from "../shared/SpotChips";
import { BettingBoard } from "./BettingBoard";
import { Wheel } from "./Wheel";

// Chat is secondary: load it after the game itself.
const LiveChat = dynamic(() => import("../shared/LiveChat").then((m) => m.LiveChat), { ssr: false });

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

const toAmounts = (b: RouletteMyBetsDTO | null) => Object.fromEntries((b?.bets ?? []).map((x) => [x.betId, x.amount]));

function NumberPill({ n, size = "sm" }: { n: number; size?: "sm" | "lg" }) {
  const tone = pocketColor(n);
  return (
    <span
      className={cn(
        "grid place-items-center rounded-full font-semibold tabular",
        size === "lg" ? "size-11 text-[18px] sm:size-14 sm:text-[22px]" : "size-7 text-[11px]",
        tone === "red" && "bg-table-red text-fg",
        tone === "black" && "bg-table-black text-fg ring-1 ring-hairline-strong",
        tone === "zero" && "bg-table-green text-fg",
      )}
    >
      {n}
    </span>
  );
}

/** Seconds left until a server deadline, ticking locally with the server clock offset applied. */
function useSecondsLeft(deadline: string | null, offset: React.RefObject<number>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, new Date(deadline).getTime() - (now + (offset.current ?? 0)));
}

export function RouletteGame() {
  const { me, setWallet } = useSession();
  const balance = me?.wallet.balance ?? 0;

  const [wheelIndex, setWheelIndex] = useState(0);
  const wheelId: WheelId = ROULETTE_WHEELS[wheelIndex]!.id;
  // A fresh table session per wheel visit; recorded on every bet.
  const [tableId, setTableId] = useState(() => crypto.randomUUID());
  const [settlement, setSettlement] = useState<RouletteSettlementDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastBets, setLastBets] = useState<Record<string, number>>({});
  const [fairOpen, setFairOpen] = useState(false);
  const [lastRevealed, setLastRevealed] = useState<{ id: string; commit: string; serverSeed: string; result: number } | null>(null);

  const spots = useSpotChips<string>(Math.min(ROULETTE_LIMITS.maxRoundTotal, balance + 0));
  const { setAmounts, clear: clearSpots, amounts } = spots;

  const seenRound = useRef<string | null>(null);
  const amountsRef = useRef(amounts);
  useEffect(() => {
    amountsRef.current = amounts;
  });

  const wide = useMedia("(min-width: 640px)");
  const { wheel, connected, offsetMs } = useRouletteSocket(wheelId, {
    onSettled: (s) => {
      setWallet({ balance: s.balance });
      setSettlement(s);
      recordRound("roulette", s.staked, s.payout);
    },
    onState: (w) => {
      const r = w.round;
      if (!r) return;
      // A new round: remember the chips for Rebet, then clear the layout.
      if (seenRound.current !== r.id) {
        const prev = seenRound.current;
        seenRound.current = r.id;
        if (prev && r.phase === "betting") {
          const placed = amountsRef.current();
          if (Object.keys(placed).length) setLastBets(placed as Record<string, number>);
          clearSpots();
          setSettlement(null);
        }
      }
      // Keep the revealed seed of each finished round for the Fair panel.
      if (r.phase === "result" && r.serverSeed && r.result !== null) {
        setLastRevealed({ id: r.id, commit: r.commit, serverSeed: r.serverSeed, result: r.result });
      }
    },
  });
  const round = wheel?.round ?? null;
  const betting = round?.phase === "betting";
  const closesIn = useSecondsLeft(betting ? round.closesAt : null, offsetMs);
  const spinLeft = useSecondsLeft(round?.phase === "spinning" ? round.spinEndsAt : null, offsetMs);
  const bettingOpen = betting && closesIn > 400;
  const roundId = round?.id ?? null;

  // Restore my bets for the live round on load / wheel switch.
  useEffect(() => {
    let cancelled = false;
    rouletteApi
      .state(wheelId)
      .then((s) => {
        if (cancelled) return;
        seenRound.current = s.wheel.round?.id ?? null;
        setAmounts(s.myBets && s.wheel.round?.phase !== "result" ? toAmounts(s.myBets) : {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wheelId, setAmounts]);

  // Bets are sent one request at a time; chips appear instantly and are reconciled with the server.
  const queue = useRef<Array<Array<{ betId: string; amount: number }>>>([]);
  const sending = useRef(false);
  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    while (queue.current.length) {
      const bets = queue.current.shift()!;
      if (!roundId) break;
      try {
        const res = await rouletteApi.place({ wheelId, roundId, tableId, bets });
        setWallet({ balance: res.balance });
        if (queue.current.length === 0) setAmounts(toAmounts(res.myBets));
      } catch (e) {
        queue.current = [];
        setError(message(e));
        const s = await rouletteApi.state(wheelId).catch(() => null);
        setAmounts(s?.myBets && s.wheel.round?.id === roundId ? toAmounts(s.myBets) : {});
      }
    }
    sending.current = false;
  }, [wheelId, roundId, tableId, setWallet, setAmounts]);

  const place = (betId: string) => {
    if (!bettingOpen) return;
    setError(null);
    const value = spots.place(betId);
    if (value === null) {
      setError(`Bets are capped at ${Math.min(ROULETTE_LIMITS.maxRoundTotal, balance + spots.total).toLocaleString()} per spin.`);
      return;
    }
    queue.current.push([{ betId, amount: value }]);
    void pump();
  };

  const rebet = () => {
    if (!bettingOpen) return;
    const bets = Object.entries(lastBets).map(([betId, amount]) => ({ betId, amount }));
    const total = bets.reduce((s, b) => s + b.amount, 0);
    if (total > Math.min(ROULETTE_LIMITS.maxRoundTotal, balance)) return setError("Not enough chips to repeat those bets.");
    setAmounts(lastBets);
    queue.current.push(bets);
    void pump();
  };

  const clearBets = async () => {
    if (!roundId || !bettingOpen) return;
    try {
      const res = await rouletteApi.clear({ wheelId, roundId });
      setWallet({ balance: res.balance });
      clearSpots();
    } catch (e) {
      setError(message(e));
    }
  };

  const nextTable = () => {
    if (spots.total > 0 && round?.phase !== "result") {
      setError("Your chips are riding on this spin. Switch after it lands.");
      return;
    }
    setWheelIndex((i) => (i + 1) % ROULETTE_WHEELS.length);
    setTableId(crypto.randomUUID());
    clearSpots();
    setSettlement(null);
    setLastBets({});
    setError(null);
  };

  // R repeats last bets, C clears, N moves to the next wheel.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === "r") rebet();
      else if (k === "c") void clearBets();
      else if (k === "n") nextTable();
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const mySettlement = settlement && settlement.roundId === round?.id ? settlement : null;
  const net = mySettlement ? mySettlement.payout - mySettlement.staked : 0;
  const status = !round
    ? "Waiting for the wheel…"
    : round.phase === "betting"
      ? bettingOpen
        ? `Place your bets · ${Math.ceil(closesIn / 1000)}s`
        : "No more bets"
      : round.phase === "spinning"
        ? "No more bets"
        : null;

  return (
    <>
      <GameShell
        game="roulette"
        title="Roulette"
        headerExtra={<LiveChat room={rouletteRoom(wheelId)} />}
        tableId={`${wheelId}-${tableId}`}
        tableLabel={ROULETTE_WHEELS[wheelIndex]!.name}
        onNextTable={nextTable}
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
              <PanelSection label="Chip value" className="@4xl:min-w-72 @4xl:flex-1">
                <ChipSelector state={spots} disabled={!bettingOpen} />
              </PanelSection>
              <div className="flex items-end justify-between gap-3 @4xl:w-80">
                <PanelSection label="On this spin">
                  <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular">{spots.total.toLocaleString()}</span>
                </PanelSection>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={clearBets} disabled={!bettingOpen || spots.total === 0}>
                    Clear
                  </Button>
                  <Button onClick={rebet} disabled={!bettingOpen || spots.total > 0 || !Object.keys(lastBets).length}>
                    Rebet
                  </Button>
                </div>
              </div>
            </div>
            <PanelSection label="Recent numbers" className="hidden lg:block">
              <div className="flex flex-wrap gap-1.5" aria-label="Recent numbers">
                <AnimatePresence initial={false} mode="popLayout">
                  {(wheel?.recent ?? []).slice(0, 12).map((n, i) => (
                    <motion.span key={`${wheel!.recent.length - i}-${n}-${i}`} layout initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                      <NumberPill n={n} />
                    </motion.span>
                  ))}
                </AnimatePresence>
              </div>
            </PanelSection>
            <p className="hidden text-[12px] leading-relaxed text-fg-muted lg:block">
              Pick a chip value, then tap the table. Tap the lines between numbers for splits, corners and streets.
            </p>
          </div>
        }
      >
        <div
          className="flex h-full flex-col gap-3 p-3 sm:gap-4 sm:p-4"
          // The wheel row takes whatever height the board doesn't need (the board is width-limited on wide screens).
          style={{ "--top": `clamp(112px, 100cqh - 44px - (100cqw - 24px) / ${wide ? "2.947" : "0.576"}, 240px)` } as React.CSSProperties}
        >
          <div className="flex shrink-0 items-center gap-3 sm:gap-5" style={{ height: "var(--top)" }}>
            <div className="aspect-square h-full shrink-0">
              <Wheel result={round && round.phase !== "betting" ? round.result : null} spinning={round?.phase === "spinning"} spinMsLeft={spinLeft} />
            </div>
            <div className="flex h-full min-w-0 flex-1 flex-col justify-between gap-1.5 overflow-hidden rounded-[12px] bg-bg/60 p-3 hairline sm:gap-2 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] text-fg-muted">
                  <span className={cn("size-1.5 rounded-full", connected ? "bg-win" : "bg-fg-disabled")} aria-hidden />
                  <span className="tabular">
                    {wheel ? `${wheel.players} playing · ${wheel.totalStaked.toLocaleString()} bet` : "Connecting…"}
                  </span>
                </div>
                <button onClick={() => setFairOpen(true)} className="shrink-0 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg">
                  Fair
                </button>
              </div>

              <div>
                <AnimatePresence mode="wait">
                  {round?.phase === "result" && round.result !== null ? (
                    <motion.div key={`r-${round.id}`} {...fadeUp} className="flex items-center gap-3">
                      <NumberPill n={round.result} size="lg" />
                      <div className="flex flex-col">
                        <span className="text-[12px] text-fg-muted capitalize sm:text-[13px]">
                          {pocketColor(round.result) === "zero" ? "Zero" : `${pocketColor(round.result)} · ${round.result % 2 ? "odd" : "even"}`}
                        </span>
                        <AnimatePresence>
                          {mySettlement && (
                            <motion.div key="net" {...fade}>
                              <WinCelebration trigger={mySettlement.roundId} multiplier={mySettlement.staked ? mySettlement.payout / mySettlement.staked : 0}>
                                <span className={cn("text-[18px] font-semibold tabular sm:text-[22px]", net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-fg-muted")}>
                                  {net === 0 ? "Even" : `${net > 0 ? "+" : "−"}${Math.abs(net).toLocaleString()}`}
                                </span>
                              </WinCelebration>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.p key={status ?? "none"} {...fade} className="text-[17px] font-semibold tracking-[-0.02em] tabular sm:text-[24px]">
                      {status}
                    </motion.p>
                  )}
                </AnimatePresence>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated">
                  <AnimatePresence>
                    {betting && round && (
                      <motion.div
                        key={round.id}
                        className="h-full origin-left bg-fg"
                        initial={{ scaleX: Math.min(1, closesIn / 15_000) }}
                        animate={{ scaleX: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: closesIn / 1000, ease: "linear" }}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>

            </div>
          </div>

          <div className="flex flex-1 items-center-safe justify-center">
          <BettingBoard
            spots={spots}
            disabled={!bettingOpen}
            winning={round?.phase === "result" ? round.result : null}
            winningBets={mySettlement?.winningBets ?? []}
            onPlace={place}
          />
          </div>
        </div>
      </GameShell>
      <FairnessDialog
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        intro="Every spin's server seed is committed (its hash published) when betting opens, before anyone bets. The result is floor(HMAC-SHA256(seed, round id) × 37), and the seed is revealed with the result."
      >
        {round && (
          <section className="flex flex-col gap-3">
            <p className="text-[13px] font-medium">This spin</p>
            <FairRow label="Round id" value={round.id} />
            <FairRow label="Server seed hash (commit)" value={round.commit} />
          </section>
        )}
        {lastRevealed && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium">Last result: {lastRevealed.result}</p>
              <div className="flex gap-3">
                <VerifiedBadge ok={verifyCommit(lastRevealed.serverSeed, lastRevealed.commit)} label="Commit verified" />
                <VerifiedBadge ok={rouletteResult(lastRevealed.serverSeed, lastRevealed.id) === lastRevealed.result} label="Result verified" />
              </div>
            </div>
            <FairRow label="Server seed" value={lastRevealed.serverSeed} />
          </section>
        )}
      </FairnessDialog>
    </>
  );
}
