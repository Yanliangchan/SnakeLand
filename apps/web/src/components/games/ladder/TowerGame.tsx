"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  INSTANT_BET_LIMITS,
  TOWER_CONFIG,
  TOWER_FLOORS,
  TOWER_MODES,
  applyX100,
  formatX100,
  ladderMultiplierX100,
  towerLayout,
  type TowerMode,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, WinCelebration } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fadeUp, tap, tapTransition } from "@/lib/motion";
import { ChipTray, StakeSummary } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { OptionPills } from "../shared/OptionPills";
import { RecentMultipliers } from "../shared/RecentMultipliers";
import { AutoPanel } from "./AutoPanel";
import { useLadderGame } from "./useLadderGame";

const MODE_LABEL: Record<TowerMode, string> = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };
const ACCENT = "#e879f9";

type DoorState = "locked" | "open" | "picked" | "trap" | "safe-shown" | "dim";

function Door({ state, onClick, disabled, label }: { state: DoorState; onClick?: () => void; disabled?: boolean; label: string }) {
  // A door leaf that swings open when its floor is resolved.
  const swung = state === "picked" || state === "trap" || state === "safe-shown";
  return (
    <motion.button
      whileTap={state === "open" && !disabled ? tap : undefined}
      transition={tapTransition}
      onClick={onClick}
      disabled={disabled || state !== "open"}
      aria-label={label}
      className={cn(
        "group relative grid h-full min-h-0 flex-1 place-items-center overflow-hidden rounded-[10px] border text-[13px] font-semibold transition-colors [perspective:340px]",
        state === "open" && "cursor-pointer border-[color-mix(in_srgb,#e879f9_55%,transparent)] bg-[color-mix(in_srgb,#e879f9_10%,transparent)] hover:bg-[color-mix(in_srgb,#e879f9_22%,transparent)]",
        state === "locked" && "border-hairline bg-bg/40",
        state === "picked" && "border-win/60 bg-win/10 text-win",
        state === "trap" && "border-loss/70 bg-loss/15 text-loss",
        state === "safe-shown" && "border-win/25 bg-win/5 text-win/70",
        state === "dim" && "border-hairline bg-bg/30 text-fg-disabled",
      )}
    >
      {/* What's behind the door: a glow for safe, a bomb for the trap. */}
      {swung && (
        <motion.span
          key="behind"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.16, ...tapTransition }}
          className="pointer-events-none absolute inset-0 grid place-items-center text-[18px]"
        >
          {state === "trap" ? "💣" : state === "picked" ? "★" : "•"}
        </motion.span>
      )}
      {/* The door leaf, hinged on the left; it swings back to reveal the result. */}
      <motion.span
        aria-hidden
        initial={false}
        animate={{ rotateY: swung ? -105 : 0, opacity: swung ? 0.15 : 1 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className={cn(
          "pointer-events-none absolute inset-0 origin-left rounded-[9px] [backface-visibility:hidden]",
          state === "open" ? "bg-[color-mix(in_srgb,#e879f9_16%,#141414)]" : "bg-elevated",
        )}
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* Door handle */}
        <span className="absolute right-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[#facc15]/80" />
        <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-white/8" />
      </motion.span>
    </motion.button>
  );
}

export function TowerGame() {
  const g = useLadderGame("tower");
  const { round, slip, pending } = g;
  const [mode, setMode] = useState<TowerMode>("medium");
  const [fairOpen, setFairOpen] = useState(false);
  const activeMode = (round?.mode as TowerMode | undefined) ?? mode;
  const { doors } = TOWER_CONFIG[activeMode];
  const playing = round?.status === "playing";
  const ended = round && round.status !== "playing";

  const pickRandom = () => {
    if (!playing || pending) return;
    void g.step(Math.floor(Math.random() * doors));
  };
  const main = () => {
    if (pending) return;
    if (playing) void g.cashOut();
    else void g.start(mode);
  };

  // Enter bets or cashes out; 1–4 pick a door; R picks one at random.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        main();
      } else if (e.key.toLowerCase() === "r") pickRandom();
      else if (/^[1-4]$/.test(e.key) && playing && Number(e.key) <= doors) void g.step(Number(e.key) - 1);
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const layout = round?.towerLayout ?? null;
  const cashValue = round ? applyX100(round.bet, round.multiplierX100) : 0;
  const outcomeOk =
    ended && round.reveal && g.lastClientSeed
      ? JSON.stringify(towerLayout(round.reveal.serverSeed, round.reveal.clientSeed, activeMode)) === JSON.stringify(layout)
      : null;

  function doorState(floor: number, door: number): DoorState {
    if (!round) return "locked";
    const pick = round.picks[floor];
    if (floor < round.level) return pick === door ? "picked" : layout?.[floor]?.includes(door) ? "safe-shown" : "dim";
    if (floor === round.level) {
      if (playing) return "open";
      if (round.status === "bust" && pick === door) return "trap";
      return layout?.[floor]?.includes(door) ? "safe-shown" : "dim";
    }
    if (ended && layout) return layout[floor]!.includes(door) ? "safe-shown" : "dim";
    return "locked";
  }

  return (
    <>
      <GameShell
        game="tower"
        title="Tower"
        tableId="tower"
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
                <OptionPills options={TOWER_MODES} value={activeMode} onChange={setMode} label={(m) => MODE_LABEL[m]} disabled={playing} />
                <p className="mt-1.5 text-[12px] text-fg-muted tabular">
                  {TOWER_CONFIG[activeMode].safe} of {TOWER_CONFIG[activeMode].doors} doors safe · top pays{" "}
                  {formatX100(ladderMultiplierX100("tower", activeMode, TOWER_FLOORS))}
                </p>
              </PanelSection>
              <div className="flex gap-2 @4xl:w-56">
                <Button variant="secondary" size="lg" onClick={pickRandom} disabled={!playing || pending} aria-label="Random door">
                  ?
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={main}
                  loading={pending}
                  disabled={(playing && round.level === 0) || (!playing && slip.amount < INSTANT_BET_LIMITS.min)}
                >
                  {playing ? (round.level === 0 ? "Pick a door" : `Cash out ${cashValue.toLocaleString()}`) : "Bet"}
                </Button>
              </div>
            </div>
            <AutoPanel g={g} mode={mode} maxSteps={TOWER_FLOORS} stepLabel="floors" pick={() => Math.floor(Math.random() * TOWER_CONFIG[mode].doors)} />
          </div>
        }
      >
        <div
          className="mx-auto flex h-full w-[var(--w)] flex-col gap-2 py-3"
          style={{ "--w": "min(100cqw - 24px, 560px)" } as React.CSSProperties}
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
            <WinCelebration trigger={round?.status === "cashed_out" ? round.id : null} multiplier={round?.status === "cashed_out" ? round.multiplierX100 / 100 : 0}>
              <p
                className={cn(
                  "text-[28px] font-semibold leading-none tracking-[-0.03em] tabular",
                  round?.status === "bust" ? "text-loss" : round?.status === "cashed_out" ? "text-win" : "text-fg",
                )}
              >
                {round?.status === "bust" ? "Trapped" : formatX100(round?.multiplierX100 ?? 100)}
              </p>
            </WinCelebration>
            {ended && (
              <p className={cn("text-[14px] font-medium tabular", round.status === "bust" ? "text-loss" : "text-win")}>
                {round.status === "bust" ? `−${round.bet.toLocaleString()}` : `+${((round.payout ?? 0) - round.bet).toLocaleString()}`}
              </p>
            )}
          </div>
          {/* Floors, top to bottom. */}
          <div className="flex min-h-0 flex-1 flex-col-reverse gap-1.5">
            {Array.from({ length: TOWER_FLOORS }, (_, floor) => {
              const active = playing && floor === round.level;
              return (
                <div key={floor} className="flex min-h-0 flex-1 items-stretch gap-2">
                  <span
                    className={cn(
                      "grid w-16 shrink-0 place-items-center rounded-[10px] text-[12px] font-semibold tabular hairline",
                      active ? "text-fg" : "text-fg-muted",
                    )}
                    style={active ? { borderColor: ACCENT } : undefined}
                  >
                    {formatX100(ladderMultiplierX100("tower", activeMode, floor + 1))}
                  </span>
                  <div className="flex min-h-0 flex-1 gap-1.5">
                    {Array.from({ length: doors }, (_, d) => (
                      <Door
                        key={d}
                        state={doorState(floor, d)}
                        disabled={pending}
                        onClick={() => void g.step(d)}
                        label={`Floor ${floor + 1}, door ${d + 1}`}
                      />
                    ))}
                  </div>
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
        outcomeLabel="Tower layout verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
