"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  INSTANT_BET_LIMITS,
  PENALTY_CONFIG,
  PENALTY_KICKS,
  PENALTY_MODES,
  applyX100,
  formatX100,
  ladderMultiplierX100,
  penaltyKeeper,
  type PenaltyMode,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, WinCelebration } from "@/components/ui";
import { cn } from "@/lib/cn";
import { expoOut, fadeUp } from "@/lib/motion";
import { useSettings } from "@/providers/settings";
import { ChipTray, StakeSummary } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { OptionPills } from "../shared/OptionPills";
import { RecentMultipliers } from "../shared/RecentMultipliers";
import { AutoPanel } from "./AutoPanel";
import { useLadderGame } from "./useLadderGame";

const MODE_LABEL: Record<PenaltyMode, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const ACCENT = "#4ade80";

/** Where the last kick went and whether the keeper got to it. */
interface Shot {
  key: string;
  spot: number;
  saved: boolean;
  keeper: number[];
}

function Keeper({ x, diving, dir }: { x: number; diving: boolean; dir: number }) {
  return (
    <motion.g
      initial={false}
      animate={{ x, rotate: diving ? dir * 62 : 0, scale: 1.45 }}
      transition={{ duration: 0.38, ease: expoOut }}
      style={{ originX: "50%", originY: "100%" }}
    >
      {/* Arms up, gloves out. */}
      <path d="M-26 -58 L-12 -40 M26 -58 L12 -40" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" />
      <circle cx="-27" cy="-60" r="6" fill="#f8fafc" />
      <circle cx="27" cy="-60" r="6" fill="#f8fafc" />
      <rect x="-13" y="-44" width="26" height="30" rx="8" fill="#fbbf24" />
      <circle cx="0" cy="-52" r="9" fill="#fde7c7" />
      <path d="M-9 -14 L-11 0 M9 -14 L11 0" stroke="#1f2937" strokeWidth="7" strokeLinecap="round" />
    </motion.g>
  );
}

export function PenaltyGame() {
  const g = useLadderGame("penalty");
  const { round, slip, pending } = g;
  const { speed } = useSettings();
  const [mode, setMode] = useState<PenaltyMode>("medium");
  const [fairOpen, setFairOpen] = useState(false);
  const activeMode = (round?.mode as PenaltyMode | undefined) ?? mode;
  const { spots, covered } = PENALTY_CONFIG[activeMode];
  const playing = round?.status === "playing";
  const ended = round && round.status !== "playing";

  // The most recent kick, derived from the round: its spot and the keeper's dive.
  const shot: Shot | null =
    round && round.picks.length > 0 && round.penaltyKeeper
      ? (() => {
          const k = round.picks.length - 1;
          const keeper = round.penaltyKeeper[k] ?? [];
          return { key: `${round.id}:${k}`, spot: round.picks[k]!, keeper, saved: keeper.includes(round.picks[k]!) };
        })()
      : null;

  const kick = (spot: number) => {
    if (!playing || pending) return;
    void g.step(spot);
  };
  const main = () => {
    if (pending) return;
    if (playing) void g.cashOut();
    else void g.start(mode);
  };

  // Enter bets or cashes out; 1–5 shoot at a spot; R shoots at random.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        main();
      } else if (e.key.toLowerCase() === "r") kick(Math.floor(Math.random() * spots));
      else if (/^[1-5]$/.test(e.key) && Number(e.key) <= spots) kick(Number(e.key) - 1);
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const cashValue = round ? applyX100(round.bet, round.multiplierX100) : 0;
  const outcomeOk =
    ended && round.reveal && g.lastClientSeed
      ? JSON.stringify(penaltyKeeper(round.reveal.serverSeed, round.reveal.clientSeed, activeMode)) ===
        JSON.stringify(round.penaltyKeeper)
      : null;

  // Goal geometry (SVG units).
  const W = 600;
  const GX = 60;
  const GW = W - GX * 2;
  const GY = 40;
  const GH = 190;
  const spotW = GW / spots;
  const spotX = (i: number) => GX + spotW * i + spotW / 2;
  const keeperX = shot ? shot.keeper.reduce((a, s) => a + spotX(s), 0) / shot.keeper.length : W / 2;
  const dir = shot ? Math.sign(keeperX - W / 2) : 0;

  return (
    <>
      <GameShell
        game="penalty"
        title="Penalty"
        tableId="penalty"
        controls={
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {g.error && (
                <motion.p {...fadeUp} role="alert" className="text-center text-[13px] text-loss">
                  {g.error}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="flex flex-col gap-4 @4xl:flex-row @4xl:items-end @4xl:gap-6">
              <PanelSection label="Bet" className="flex flex-col gap-2 @4xl:min-w-72 @4xl:flex-1">
                <StakeSummary slip={slip} limit={Math.min(INSTANT_BET_LIMITS.max, g.balance)} disabled={playing} />
                <ChipTray slip={slip} disabled={playing} />
              </PanelSection>
              <PanelSection label="Difficulty" className="@4xl:w-72">
                <OptionPills options={PENALTY_MODES} value={activeMode} onChange={setMode} label={(m) => MODE_LABEL[m]} disabled={playing} />
                <p className="mt-1.5 text-[12px] text-fg-muted tabular">
                  {spots} spots, keeper covers {covered} · 10 goals pay{" "}
                  {formatX100(ladderMultiplierX100("penalty", activeMode, PENALTY_KICKS))}
                </p>
              </PanelSection>
              <div className="flex gap-2 @4xl:w-56">
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => kick(Math.floor(Math.random() * spots))}
                  disabled={!playing || pending}
                  aria-label="Shoot at a random spot"
                >
                  ?
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={main}
                  loading={pending}
                  disabled={(playing && round.level === 0) || (!playing && slip.amount < INSTANT_BET_LIMITS.min)}
                >
                  {playing ? (round.level === 0 ? "Pick a spot" : `Cash out ${cashValue.toLocaleString()}`) : "Bet"}
                </Button>
              </div>
            </div>
            <AutoPanel g={g} mode={mode} maxSteps={PENALTY_KICKS} stepLabel="goals" pick={() => Math.floor(Math.random() * PENALTY_CONFIG[mode].spots)} />
          </div>
        }
      >
        <div
          className="mx-auto flex h-full w-[var(--w)] flex-col gap-2 py-3"
          style={{ "--w": "min(100cqw - 24px, 640px)" } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-3">
            <RecentMultipliers items={g.recent} />
            <button
              onClick={() => setFairOpen(true)}
              className="shrink-0 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
            >
              Fair
            </button>
          </div>
          <div className="flex h-10 items-end justify-between">
            <WinCelebration
              trigger={round?.status === "cashed_out" ? round.id : null}
              multiplier={round?.status === "cashed_out" ? round.multiplierX100 / 100 : 0}
            >
              <p
                className={cn(
                  "text-[28px] font-semibold leading-none tracking-[-0.03em] tabular",
                  round?.status === "bust" ? "text-loss" : round?.status === "cashed_out" ? "text-win" : "text-fg",
                )}
              >
                {round?.status === "bust" ? "Saved" : formatX100(round?.multiplierX100 ?? 100)}
              </p>
            </WinCelebration>
            {ended && (
              <p className={cn("text-[14px] font-medium tabular", round.status === "bust" ? "text-loss" : "text-win")}>
                {round.status === "bust" ? `−${round.bet.toLocaleString()}` : `+${((round.payout ?? 0) - round.bet).toLocaleString()}`}
              </p>
            )}
          </div>

          {/* The pitch: goal, keeper, clickable target spots, and the ball. */}
          <div className="relative min-h-0 flex-1">
            <svg viewBox={`0 0 ${W} 380`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full" role="group" aria-label="Goal">
              <defs>
                <linearGradient id="pk-grass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#14532d" />
                  <stop offset="1" stopColor="#052e16" />
                </linearGradient>
                <pattern id="pk-net" width="14" height="14" patternUnits="userSpaceOnUse">
                  <path d="M0 0L14 14M14 0L0 14" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect x="0" y={GY + GH} width={W} height={380 - GY - GH} fill="url(#pk-grass)" rx="14" />
              {Array.from({ length: 6 }, (_, i) => (
                <rect key={i} x={i * 100} y={GY + GH} width="50" height={380 - GY - GH} fill="rgba(255,255,255,0.025)" />
              ))}
              <path d={`M40 ${GY + GH + 40} H${W - 40}`} stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
              <circle cx={W / 2} cy="330" r="3.5" fill="rgba(255,255,255,0.6)" />
              <rect x={GX} y={GY} width={GW} height={GH} fill="url(#pk-net)" />
              <path d={`M${GX} ${GY + GH} V${GY} H${GX + GW} V${GY + GH}`} stroke="#f8fafc" strokeWidth="7" fill="none" strokeLinejoin="round" />

              {/* Target spots. */}
              {Array.from({ length: spots }, (_, i) => {
                const saved = shot?.keeper.includes(i);
                const isShot = shot?.spot === i;
                return (
                  <g key={i}>
                    <motion.rect
                      x={GX + spotW * i + 6}
                      y={GY + 10}
                      width={spotW - 12}
                      height={GH - 16}
                      rx="12"
                      fill={
                        isShot && shot?.saved
                          ? "rgba(240,82,75,0.18)"
                          : isShot
                            ? "rgba(74,222,128,0.16)"
                            : saved
                              ? "rgba(251,191,36,0.08)"
                              : "rgba(255,255,255,0)"
                      }
                      stroke={playing ? "rgba(74,222,128,0.55)" : "rgba(255,255,255,0.08)"}
                      strokeDasharray={playing ? "6 6" : undefined}
                      strokeWidth="2"
                      className={cn(playing && !pending && "cursor-pointer hover:fill-[rgba(74,222,128,0.12)]")}
                      onClick={() => kick(i)}
                      role={playing ? "button" : undefined}
                      aria-label={playing ? `Shoot at spot ${i + 1}` : undefined}
                    />
                    <text
                      x={spotX(i)}
                      y={GY + GH / 2 + 5}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="600"
                      fill="rgba(255,255,255,0.35)"
                      pointerEvents="none"
                    >
                      {i + 1}
                    </text>
                  </g>
                );
              })}

              <g transform={`translate(0 ${GY + GH})`}>
                <Keeper key={round?.id ?? "idle"} x={keeperX} diving={!!shot} dir={dir} />
              </g>

              {/* The ball: flies from the spot to the chosen target, and bounces off the keeper on a save. */}
              <AnimatePresence initial={false}>
                <motion.g
                  key={shot?.key ?? "rest"}
                  initial={shot ? { x: W / 2, y: 330, scale: 1 } : false}
                  animate={
                    shot
                      ? shot.saved
                        ? { x: [W / 2, spotX(shot.spot), spotX(shot.spot) + dir * -40], y: [330, GY + GH - 70, GY + GH + 40], scale: [1, 0.7, 0.8] }
                        : { x: spotX(shot.spot), y: GY + 60, scale: 0.62 }
                      : { x: W / 2, y: 330, scale: 1 }
                  }
                  transition={{ duration: 0.5 * speed, ease: expoOut }}
                >
                  <circle r="13" fill="#f8fafc" stroke="#0f172a" strokeWidth="1.5" />
                  <path d="M0 -6 L5.7 -1.9 L3.5 4.9 L-3.5 4.9 L-5.7 -1.9 Z" fill="#0f172a" />
                </motion.g>
              </AnimatePresence>
            </svg>
          </div>

          {/* The ten kicks and what each one pays. */}
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: PENALTY_KICKS }, (_, k) => {
              const scored = round ? k < round.level : false;
              const miss = round?.status === "bust" && k === round.level;
              const next = playing && k === round.level;
              return (
                <div
                  key={k}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-[8px] py-1 text-[10px] font-semibold tabular hairline",
                    scored && "bg-win/15 text-win",
                    miss && "bg-loss/15 text-loss",
                    !scored && !miss && "text-fg-muted",
                  )}
                  style={next ? { borderColor: ACCENT } : undefined}
                >
                  <span className="text-[12px]">{scored ? "●" : miss ? "✕" : "○"}</span>
                  {formatX100(ladderMultiplierX100("penalty", activeMode, k + 1))}
                </div>
              );
            })}
          </div>
        </div>
      </GameShell>
      <InstantFairness
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        nextCommit={g.nextCommit}
        clientSeed={g.clientSeed}
        last={ended ? round.reveal : null}
        outcomeLabel="Keeper dives verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
