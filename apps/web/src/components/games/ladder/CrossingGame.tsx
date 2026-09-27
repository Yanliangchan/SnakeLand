"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  CROSSING_CONFIG,
  CROSSING_MODES,
  INSTANT_BET_LIMITS,
  applyX100,
  crossingHitLane,
  formatX100,
  ladderMultiplierX100,
  type CrossingMode,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, WinCelebration } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";
import { useSettings } from "@/providers/settings";
import { ChipTray, StakeSummary } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { OptionPills } from "../shared/OptionPills";
import { RecentMultipliers } from "../shared/RecentMultipliers";
import { AutoPanel } from "./AutoPanel";
import { useLadderGame } from "./useLadderGame";

const MODE_LABEL: Record<CrossingMode, string> = { easy: "Easy", medium: "Medium", hard: "Hard", daredevil: "Daredevil" };
const CAR_COLOURS = ["#f0524b", "#38bdf8", "#facc15", "#a78bfa", "#fb923c", "#2dd4bf"];
const LANE_W = 88;

function Duck({ squashed }: { squashed: boolean }) {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden style={{ transform: squashed ? "scaleY(0.35)" : undefined, transformOrigin: "bottom" }}>
      <ellipse cx="23" cy="42" rx="12" ry="3" fill="rgba(0,0,0,0.35)" />
      <ellipse cx="22" cy="28" rx="13" ry="11" fill="#facc15" />
      <circle cx="28" cy="15" r="8" fill="#fde047" />
      <path d="M35 15 L43 17 L35 19 Z" fill="#fb923c" />
      <circle cx="30" cy="13" r="1.8" fill={squashed ? "#ff4d4d" : "#0a0a0a"} />
      <path d="M12 26 Q18 22 22 28" stroke="#eab308" strokeWidth="2" fill="none" />
    </svg>
  );
}

function Car({ colour, delay, duration, still }: { colour: string; delay: number; duration: number; still?: boolean }) {
  return (
    <div
      className={cn("absolute left-1/2 -ml-[17px] w-[34px]", !still && "animate-[drive_linear_infinite]")}
      style={still ? { top: "40%" } : { animationDelay: `${delay}s`, animationDuration: `${duration}s`, top: "-70px" }}
    >
      <svg width="34" height="58" viewBox="0 0 34 58" aria-hidden>
        <rect x="2" y="2" width="30" height="54" rx="8" fill={colour} />
        <rect x="6" y="36" width="22" height="12" rx="3" fill="#0f172a" opacity="0.75" />
        <rect x="6" y="12" width="22" height="9" rx="3" fill="#0f172a" opacity="0.55" />
        <rect x="4" y="52" width="6" height="3" rx="1" fill="#fef08a" />
        <rect x="24" y="52" width="6" height="3" rx="1" fill="#fef08a" />
      </svg>
    </div>
  );
}

export function CrossingGame() {
  const g = useLadderGame("crossing");
  const { round, slip, pending } = g;
  const { reducedMotion } = useSettings();
  const [mode, setMode] = useState<CrossingMode>("medium");
  const [fairOpen, setFairOpen] = useState(false);
  const activeMode = (round?.mode as CrossingMode | undefined) ?? mode;
  const { lanes, survive } = CROSSING_CONFIG[activeMode];
  const playing = round?.status === "playing";
  const ended = round && round.status !== "playing";
  const bust = round?.status === "bust";
  // Where the duck stands: 0 = the start kerb, n = in lane n (1-based).
  const position = round ? (bust ? round.level + 1 : round.level) : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const duckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    duckRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [position, reducedMotion]);

  const main = () => {
    if (pending) return;
    if (playing) void g.step();
    else void g.start(mode);
  };

  // Space bets or hops; C cashes out.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        main();
      } else if (e.key.toLowerCase() === "c") void g.cashOut();
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const cashValue = round ? applyX100(round.bet, round.multiplierX100) : 0;
  const outcomeOk =
    ended && round.reveal
      ? crossingHitLane(round.reveal.serverSeed, round.reveal.clientSeed, activeMode) === round.crossingHitLane
      : null;

  return (
    <>
      <GameShell
        game="crossing"
        title="Crossing"
        tableId="crossing"
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
              <PanelSection label="Traffic" className="@4xl:w-80">
                <OptionPills options={CROSSING_MODES} value={activeMode} onChange={setMode} label={(m) => MODE_LABEL[m]} disabled={playing} />
                <p className="mt-1.5 text-[12px] text-fg-muted tabular">
                  {Math.round((1 - survive[0] / survive[1]) * 100)}% hit chance per lane · {lanes} lanes
                </p>
              </PanelSection>
              <div className="flex gap-2 @4xl:w-64">
                {playing && (
                  <Button variant="secondary" size="lg" onClick={() => void g.cashOut()} disabled={pending || round.level === 0}>
                    Cash out
                  </Button>
                )}
                <Button size="lg" className="flex-1" onClick={main} loading={pending} disabled={!playing && slip.amount < INSTANT_BET_LIMITS.min}>
                  {playing ? `Hop · ${formatX100(round.nextMultiplierX100 ?? round.multiplierX100)}` : "Bet"}
                </Button>
              </div>
            </div>
            <AutoPanel g={g} mode={mode} maxSteps={CROSSING_CONFIG[mode].lanes} stepLabel="lanes" pick={() => undefined} />
          </div>
        }
      >
        <div className="flex h-full flex-col gap-2 p-3 sm:p-4">
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
            <WinCelebration trigger={round?.status === "cashed_out" ? round.id : null} multiplier={round?.status === "cashed_out" ? round.multiplierX100 / 100 : 0}>
              <p className={cn("text-[28px] font-semibold leading-none tracking-[-0.03em] tabular", bust ? "text-loss" : round?.status === "cashed_out" ? "text-win" : "text-fg")}>
                {bust ? "Hit!" : formatX100(round?.multiplierX100 ?? 100)}
              </p>
            </WinCelebration>
            <p className={cn("text-[14px] font-medium tabular", bust ? "text-loss" : ended ? "text-win" : "text-fg-muted")}>
              {ended
                ? bust
                  ? `−${round.bet.toLocaleString()}`
                  : `+${((round.payout ?? 0) - round.bet).toLocaleString()}`
                : playing && round.level > 0
                  ? `Cash out ${cashValue.toLocaleString()}`
                  : ""}
            </p>
          </div>

          <div ref={scroller} className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-[12px] bg-[#1c1f24] hairline">
            <div className="relative flex h-full" style={{ width: (lanes + 2) * LANE_W }}>
              {/* Start kerb */}
              <div className="relative h-full shrink-0 border-r-4 border-[#2a2f36] bg-[#15181c]" style={{ width: LANE_W }}>
                {position === 0 && (
                  <div ref={duckRef} className="absolute left-1/2 top-1/2 -ml-[23px] -mt-[23px]">
                    <Duck squashed={false} />
                  </div>
                )}
              </div>
              {Array.from({ length: lanes }, (_, i) => {
                const lane = i + 1;
                const cleared = round ? lane <= round.level : false;
                const here = position === lane;
                const fatal = bust && round.level + 1 === lane;
                const ahead = !round || lane > position;
                return (
                  <div
                    key={i}
                    className={cn("relative h-full shrink-0 overflow-hidden", i > 0 && "border-l-2 border-dashed border-white/15")}
                    style={{ width: LANE_W }}
                  >
                    <span
                      className={cn(
                        "absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular",
                        cleared ? "bg-win/20 text-win" : here && playing ? "bg-[#facc15] text-bg" : "bg-black/40 text-fg-muted",
                      )}
                    >
                      {formatX100(ladderMultiplierX100("crossing", activeMode, lane))}
                    </span>
                    {cleared && <div className="absolute inset-x-3 top-9 h-1.5 rounded-full bg-win/40" aria-hidden />}
                    {ahead && !reducedMotion && (
                      <Car colour={CAR_COLOURS[i % CAR_COLOURS.length]!} delay={-(i * 0.7) % 3} duration={2.2 + ((i * 37) % 17) / 10} />
                    )}
                    {fatal && <Car colour="#f0524b" delay={0} duration={0} still />}
                    {here && (
                      <motion.div
                        ref={duckRef}
                        key={`duck-${lane}`}
                        initial={{ y: -18, scale: 0.9 }}
                        animate={{ y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 420, damping: 18 }}
                        className="absolute left-1/2 top-1/2 z-20 -ml-[23px] -mt-[23px]"
                      >
                        <Duck squashed={Boolean(fatal)} />
                      </motion.div>
                    )}
                  </div>
                );
              })}
              {/* Finish kerb */}
              <div className="relative h-full shrink-0 border-l-4 border-[#2a2f36] bg-[#15181c]" style={{ width: LANE_W }}>
                <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                  Finish
                </span>
              </div>
            </div>
          </div>
        </div>
      </GameShell>
      <InstantFairness
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        nextCommit={g.nextCommit}
        clientSeed={g.clientSeed}
        last={ended ? round.reveal : null}
        outcomeLabel="Road verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
