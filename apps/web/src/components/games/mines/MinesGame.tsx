"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  INSTANT_BET_LIMITS,
  MINES_DEFAULT_SIZE,
  MINES_SIZES,
  minesMultiplierX100,
  minesRange,
  minesTiles,
  applyX100,
  formatX100,
  minesPositions,
  type FairRevealDTO,
  type MinesRoundDTO,
  type MinesUpdateDTO,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, WinCelebration } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { minesApi } from "@/lib/instant-api";
import { useEventPlay } from "@/components/events/EventPlay";
import { fade, fadeUp, tap, tapTransition } from "@/lib/motion";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { ChipTray, StakeSummary, useChipSlip } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { RecentMultipliers, type RecentItem } from "../shared/RecentMultipliers";
import { useClientSeed } from "../shared/useClientSeed";
import { Tile, type TileState } from "./Tile";

/** Quick picks scale with the board: a few, a quarter, half, and all-but-one. */
const presetsFor = (tiles: number) =>
  [...new Set([1, 3, Math.round(tiles / 4), Math.round(tiles / 2), tiles - 1])].filter((n) => n >= 1 && n < tiles);

/**
 * Tile states for the board. `replayStep` (replay mode) shows only the first
 * n picks, then the bust, then the full reveal.
 */
function tileStates(round: MinesRoundDTO | null, tiles: number, replayStep: number | null = null): TileState[] {
  const states: TileState[] = Array(tiles).fill("hidden");
  if (!round) return states;
  const picks = replayStep === null ? round.picks : round.picks.slice(0, replayStep);
  for (const t of picks) states[t] = "gem";
  if (replayStep !== null && replayStep <= round.picks.length) return states;
  if (round.status !== "playing" && round.minePositions) {
    const mines = new Set(round.minePositions);
    for (let t = 0; t < tiles; t++) {
      if (states[t] === "gem") continue;
      states[t] = t === round.bustTile ? "bust" : mines.has(t) ? "mine" : "gem-dim";
    }
  }
  return states;
}

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

function MinesStepper({
  value,
  tiles,
  onChange,
  disabled,
}: {
  value: number;
  tiles: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const { min, max } = minesRange(tiles);
  const btn = "grid size-9 place-items-center rounded-[10px] text-fg-muted transition-colors hairline hover:text-fg disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <motion.button whileTap={tap} transition={tapTransition} className={btn} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label="Fewer mines">
          −
        </motion.button>
        <div className="flex w-16 flex-col items-center leading-tight">
          <span className="text-[17px] font-semibold tabular">{value}</span>
          <span className="text-[11px] text-fg-muted">{value === 1 ? "mine" : "mines"}</span>
        </div>
        <motion.button whileTap={tap} transition={tapTransition} className={btn} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label="More mines">
          +
        </motion.button>
      </div>
      <div className="flex gap-1">
        {presetsFor(tiles).map((p) => (
          <motion.button
            key={p}
            whileTap={tap}
            transition={tapTransition}
            disabled={disabled}
            onClick={() => onChange(p)}
            className={cn(
              "h-8 min-w-8 rounded-[8px] px-2 text-[12px] font-medium tabular transition-colors hairline disabled:opacity-40",
              p === value ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
            )}
          >
            {p}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function SizePicker({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="Board size">
      {MINES_SIZES.map((n) => (
        <motion.button
          key={n}
          role="radio"
          aria-checked={n === value}
          whileTap={tap}
          transition={tapTransition}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={cn(
            "h-9 rounded-[8px] text-[12px] font-medium tabular transition-colors hairline disabled:opacity-40",
            n === value ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
          )}
        >
          {n}×{n}
        </motion.button>
      ))}
    </div>
  );
}

export function MinesGame() {
  const { me, setWallet } = useSession();
  const { play, speed } = useSettings();
  const [replay, setReplay] = useState<{ roundId: string; step: number } | null>(null);
  const clientSeed = useClientSeed();
  const balance = me?.wallet.balance ?? 0;
  const slip = useChipSlip(Math.min(INSTANT_BET_LIMITS.max, balance));

  const [round, setRound] = useState<MinesRoundDTO | null>(null);
  const [nextCommit, setNextCommit] = useState<string | null>(null);
  const [chosenSize, setSize] = useState<number>(MINES_DEFAULT_SIZE);
  const [chosenMines, setMines] = useState(3);
  // A Mines race fixes the board for everyone.
  const raceBoard = useEventPlay()?.event.mines ?? null;
  const size = raceBoard?.size ?? chosenSize;
  const mines = raceBoard?.mines ?? chosenMines;
  // A round in play fixes the board; otherwise the chosen size does.
  const boardSize = round?.size ?? size;
  const tiles = minesTiles(boardSize);
  const changeSize = (n: number) => {
    setSize(n);
    setMines((m) => Math.min(m, minesRange(minesTiles(n)).max));
    // Leaving a finished board on screen at the old size would be confusing.
    if (round && round.status !== "playing") setRound(null);
  };
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [lastReveal, setLastReveal] = useState<{ reveal: FairRevealDTO; tiles: number; mines: number; positions: number[] } | null>(null);
  const [fairOpen, setFairOpen] = useState(false);
  const busy = useRef(false);

  const playing = round?.status === "playing";
  const setSlip = slip.set;

  useEffect(() => {
    let cancelled = false;
    minesApi
      .state()
      .then((s) => {
        if (cancelled) return;
        setNextCommit(s.nextCommit);
        if (s.round) {
          setRound(s.round);
          setMines(s.round.mines);
          setSize(s.round.size);
          setSlip(s.round.bet);
        }
        setLoaded(true);
      })
      .catch((e: unknown) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [setSlip]);

  function apply(u: MinesUpdateDTO) {
    setRound(u.round);
    setNextCommit(u.nextCommit);
    if (u.balance !== null) setWallet({ balance: u.balance });
    if (u.round.status !== "playing") {
      recordRound("mines", u.round.bet, u.round.payout ?? 0);
      const x100 = u.round.status === "bust" ? 0 : u.round.multiplierX100;
      setRecent((r) => [{ id: u.round.id, x100 }, ...r].slice(0, 12));
      if (u.round.reveal && u.round.minePositions) {
        setLastReveal({ reveal: u.round.reveal, tiles: minesTiles(u.round.size), mines: u.round.mines, positions: u.round.minePositions });
      }
    }
  }

  async function run(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "STALE_VERSION" || e.code === "ROUND_SETTLED")) {
        const s = await minesApi.state();
        setRound(s.round);
        setNextCommit(s.nextCommit);
      } else setError(message(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const start = () =>
    run(async () => {
      if (slip.amount < INSTANT_BET_LIMITS.min) return setError(`Minimum bet is ${INSTANT_BET_LIMITS.min}.`);
      apply(await minesApi.start({ bet: slip.amount, size, mines, clientSeed: clientSeed.next() }));
    });

  const pick = (tile: number) =>
    run(async () => {
      if (!round || round.status !== "playing") return;
      const u = await minesApi.reveal(round.id, tile, round.version);
      play(u.round.status === "bust" ? "click" : "flip");
      apply(u);
    });

  const pickRandom = () => {
    if (!round) return;
    const open = Array.from({ length: minesTiles(round.size) }, (_, i) => i).filter((i) => !round.picks.includes(i));
    const tile = open[crypto.getRandomValues(new Uint32Array(1))[0]! % open.length];
    if (tile !== undefined) void pick(tile);
  };

  const cashOut = () =>
    run(async () => {
      if (!round || round.status !== "playing") return;
      apply(await minesApi.cashOut(round.id, round.version));
    });

  // Keyboard: Enter bets or cashes out, R picks a random tile.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void (playing ? cashOut() : start());
      } else if (e.key.toLowerCase() === "r" && playing) {
        e.preventDefault();
        pickRandom();
      }
    };
  });
  // Replay: one pick every ~350ms, then the bust and the full board.
  const replayingId = replay?.roundId;
  useEffect(() => {
    if (!replayingId) return;
    const total = round?.picks.length ?? 0;
    const t = setInterval(() => {
      setReplay((r) => (!r || r.step > total ? null : { ...r, step: r.step + 1 }));
      play("pop");
    }, 350 * speed);
    return () => clearInterval(t);
    // Restart only when a new replay begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayingId]);

  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const replayStep = replay && round && replay.roundId === round.id ? replay.step : null;
  const states = tileStates(round, tiles, replayStep);
  const cashValue = round ? applyX100(round.bet, round.multiplierX100) : 0;
  const ended = round && round.status !== "playing";
  const safePicks = round?.picks.length ?? 0;
  const nearX100 = round?.status === "bust" && safePicks > 0 ? minesMultiplierX100(tiles, round.mines, safePicks) : null;

  const startReplay = () => {
    if (!round || round.status === "playing") return;
    setReplay({ roundId: round.id, step: 0 });
  };

  const outcomeOk = lastReveal
    ? JSON.stringify(minesPositions(lastReveal.reveal.serverSeed, lastReveal.reveal.clientSeed, lastReveal.tiles, lastReveal.mines)) ===
      JSON.stringify(lastReveal.positions)
    : null;

  return (
    <>
      <GameShell
        game="mines"
        title="Mines"
        tableId="mines"
        controls={
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {error && (
                <motion.p {...fadeUp} role="alert" className="text-center text-[13px] text-loss">
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              {playing ? (
                <motion.div key="playing" {...fadeUp} className="flex flex-col gap-3 @4xl:flex-row @4xl:items-center">
                  <div className="rounded-[12px] bg-bg/60 px-4 py-3 hairline @4xl:flex-1">
                    <p className="text-[12px] text-fg-muted">
                      {round.picks.length === 0 ? "Pick a tile. Cash out whenever you like." : `${round.picks.length} safe`}
                    </p>
                    <p className="text-[15px] font-semibold tabular">
                      Next pick {round.nextMultiplierX100 ? formatX100(round.nextMultiplierX100) : "—"}
                    </p>
                  </div>
                  <div className="grid grid-cols-[1fr_2fr] gap-2 @4xl:w-80">
                    <Button variant="secondary" size="lg" onClick={pickRandom} disabled={pending}>
                      Random
                    </Button>
                    <Button size="lg" onClick={cashOut} disabled={pending || round.picks.length === 0}>
                      Cash out {round.picks.length > 0 ? cashValue.toLocaleString() : ""}
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="idle" {...fadeUp} className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:gap-6">
                  <PanelSection label="Bet" className="flex flex-col gap-2 @4xl:min-w-72 @4xl:flex-1">
                    <StakeSummary slip={slip} limit={Math.min(INSTANT_BET_LIMITS.max, balance)} disabled={pending} />
                    <ChipTray slip={slip} disabled={pending || !loaded} />
                  </PanelSection>
                  <PanelSection label="Board">
                    <SizePicker value={size} onChange={changeSize} disabled={pending || !loaded || !!raceBoard} />
                  </PanelSection>
                  <PanelSection label="Mines">
                    <MinesStepper value={mines} tiles={minesTiles(size)} onChange={setMines} disabled={pending || !loaded || !!raceBoard} />
                  </PanelSection>
                  <Button size="lg" block className="@4xl:w-44" onClick={start} loading={pending} disabled={!loaded || slip.amount < INSTANT_BET_LIMITS.min}>
                    Bet
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
      >
        <div
          className="mx-auto flex h-full w-[var(--board)] flex-col justify-center gap-3 py-3 sm:gap-4 sm:py-5"
            // The grid is square: as large as the stage allows in both directions.
          style={{ "--board": "min(100cqw - 24px, 100cqh - 150px, 580px)" } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-3">
            <RecentMultipliers items={recent} />
            {ended && (
              <button
                onClick={startReplay}
                disabled={replayStep !== null}
                className="ml-auto shrink-0 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg disabled:opacity-40"
              >
                {replayStep !== null ? "Replaying…" : "Replay"}
              </button>
            )}
            <button
              onClick={() => setFairOpen(true)}
              className="shrink-0 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
            >
              Fair
            </button>
          </div>

          <div className="flex h-16 items-end justify-between">
            <div>
              <p className="text-[12px] text-fg-muted">Multiplier</p>
              <WinCelebration
                trigger={round?.status === "cashed_out" ? round.id : null}
                multiplier={round?.status === "cashed_out" ? round.multiplierX100 / 100 : 0}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.p
                    key={`${round?.id}-${round?.multiplierX100}-${round?.status}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "text-[32px] font-semibold leading-none tracking-[-0.03em] tabular",
                      round?.status === "cashed_out" ? "text-win" : round?.status === "bust" ? "text-loss" : "text-fg",
                    )}
                  >
                    {round?.status === "bust" ? "Bust" : formatX100(round?.multiplierX100 ?? 100)}
                  </motion.p>
                </AnimatePresence>
              </WinCelebration>
            </div>
            <AnimatePresence mode="wait">
              {ended && (
                <motion.div key={round.id} {...fade} className="text-right">
                  <p className={cn("text-[15px] font-medium tabular", round.status === "bust" ? "text-loss" : "text-win")}>
                    {round.status === "bust"
                      ? `−${round.bet.toLocaleString()}`
                      : `+${((round.payout ?? 0) - round.bet).toLocaleString()}`}
                  </p>
                  {/* Near miss: what cashing out before the fatal pick would have paid. */}
                  {round.status === "bust" && (
                    <p className="mt-0.5 text-[12px] text-fg-muted tabular">
                      {nearX100
                        ? `One pick earlier: ${formatX100(nearX100)} · +${(applyX100(round.bet, nearX100) - round.bet).toLocaleString()}`
                        : `First pick: ${Math.round((round.mines / tiles) * 100)}% were mines`}
                    </p>
                  )}
                </motion.div>
              )}
              {playing && round.picks.length > 0 && (
                <motion.p key="profit" {...fade} className="text-[15px] font-medium text-fg-muted tabular">
                  Profit {(cashValue - round.bet).toLocaleString()}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="grid aspect-square w-full gap-[1.5%]" style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}>
            {states.map((s, i) => (
              <Tile
                key={i}
                index={i}
                state={s}
                disabled={!playing || pending}
                onPick={pick}
                // Stagger the end-of-round reveal outward from the last tile opened.
                delay={
                  ended && replayStep === null && !round.picks.includes(i) && i !== round.bustTile
                    ? (0.15 + (i % boardSize) * 0.02 + Math.floor(i / boardSize) * 0.02) * speed
                    : 0
                }
              />
            ))}
          </div>
        </div>
      </GameShell>
      <InstantFairness
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        nextCommit={nextCommit}
        clientSeed={clientSeed}
        last={lastReveal?.reveal ?? null}
        outcomeLabel="Mines verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
