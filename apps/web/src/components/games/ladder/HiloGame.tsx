"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  HILO_CHOICES,
  HILO_MAX_STEPS,
  INSTANT_BET_LIMITS,
  applyX100,
  formatX100,
  hiloCardCode,
  hiloCards,
  hiloWinningRanks,
  type HiloChoice,
  type LadderRoundDTO,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, PlayingCard, WinCelebration } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";
import { ChipTray, StakeSummary } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { RecentMultipliers } from "../shared/RecentMultipliers";
import { AutoPanel } from "./AutoPanel";
import { useLadderGame } from "./useLadderGame";

/** Auto play takes the likelier side (ties win), skipping cards where neither pays. */
function hiloAutoPick(r: LadderRoundDTO): HiloChoice {
  const n = r.hiloNext;
  if (!n || (n.higher === null && n.lower === null)) return "skip";
  if (n.higher === null) return "lower";
  if (n.lower === null) return "higher";
  return n.higher <= n.lower ? "higher" : "lower";
}

const pct = (k: number) => `${Math.round((k / 13) * 100)}%`;

export function HiloGame() {
  const g = useLadderGame("hilo");
  const { round, slip, pending } = g;
  const [fairOpen, setFairOpen] = useState(false);
  const playing = round?.status === "playing";
  const ended = round && round.status !== "playing";
  const cards = round?.hiloCards ?? [];
  const current = cards.at(-1);
  const next = round?.hiloNext ?? null;
  const canSkip = playing && round.picks.length < HILO_MAX_STEPS - 1;

  const guess = (choice: HiloChoice) => {
    if (!playing || pending) return;
    if (choice === "skip" ? !canSkip : next?.[choice] == null) return;
    void g.step(choice);
  };
  const main = () => {
    if (pending) return;
    if (playing) void g.cashOut();
    else void g.start("classic");
  };

  // Enter bets or cashes out; H / ↑ higher; L / ↓ lower; S skips.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (e.key === "Enter") {
        e.preventDefault();
        main();
      } else if (k === "h" || e.key === "ArrowUp") guess("higher");
      else if (k === "l" || e.key === "ArrowDown") guess("lower");
      else if (k === "s") guess("skip");
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
      ? JSON.stringify(hiloCards(round.reveal.serverSeed, round.reveal.clientSeed).slice(0, cards.length)) === JSON.stringify(cards)
      : null;

  // Previous cards, each tagged with the guess made on it.
  const trail = cards.slice(0, -1).map((c, i) => ({ card: c, pick: HILO_CHOICES[round!.picks[i]!]! }));

  const option = (choice: "higher" | "lower") => {
    const k = current === undefined ? 7 : hiloWinningRanks(current, choice);
    const x = next?.[choice] ?? null;
    const name = choice === "higher" ? "Higher" : "Lower";
    return (
      <button
        key={choice}
        onClick={() => guess(choice)}
        disabled={!playing || pending || x === null}
        aria-label={`${name} or same, pays ${x === null ? "nothing more" : formatX100(x)}`}
        className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-[var(--radius-ui)] bg-elevated leading-tight transition-colors hairline hover:border-hairline-strong disabled:opacity-40"
      >
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          <span aria-hidden className="text-[11px]">
            {choice === "higher" ? "▲" : "▼"}
          </span>
          {name}
        </span>
        <span className="mt-0.5 text-[11px] font-medium text-fg-muted tabular">
          {playing ? `${pct(k)} · ${x === null ? "—" : formatX100(x)}` : "or same"}
        </span>
      </button>
    );
  };

  return (
    <>
      <GameShell
        game="hilo"
        title="Hi-Lo"
        tableId="hilo"
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
              <PanelSection label="Guess" className="flex flex-col gap-2 @4xl:w-96">
                <div className="flex gap-2">
                  {option("higher")}
                  {option("lower")}
                  <button
                    onClick={() => guess("skip")}
                    disabled={!canSkip || pending}
                    aria-label="Skip this card"
                    className="h-14 shrink-0 rounded-[var(--radius-ui)] bg-elevated px-4 text-[14px] font-medium transition-colors hairline hover:border-hairline-strong disabled:opacity-40"
                  >
                    Skip
                  </button>
                </div>
                <Button
                  size="lg"
                  onClick={main}
                  loading={pending}
                  disabled={(playing && round.level === 0) || (!playing && slip.amount < INSTANT_BET_LIMITS.min)}
                >
                  {playing ? (round.level === 0 ? "Make a guess" : `Cash out ${cashValue.toLocaleString()}`) : "Bet"}
                </Button>
              </PanelSection>
            </div>
            <AutoPanel g={g} mode={"classic"} maxSteps={10} stepLabel="correct calls" pick={hiloAutoPick} />
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
                {round?.status === "bust" ? "Wrong call" : formatX100(round?.level ? round.multiplierX100 : 100)}
              </p>
            </WinCelebration>
            {ended && (
              <p className={cn("text-[14px] font-medium tabular", round.status === "bust" ? "text-loss" : "text-win")}>
                {round.status === "bust" ? `−${round.bet.toLocaleString()}` : `+${((round.payout ?? 0) - round.bet).toLocaleString()}`}
              </p>
            )}
          </div>

          {/* The current card, big, with the deck beside it. */}
          <div className="grid min-h-0 flex-1 place-items-center">
            <div className="flex items-center gap-6 [--card-h:clamp(120px,32cqh,220px)]">
              <PlayingCard card={null} i={0} className="!h-[calc(var(--card-h)*0.8)] opacity-60" />
              <AnimatePresence mode="popLayout" initial={false}>
                <PlayingCard
                  key={`${round?.id ?? "idle"}:${cards.length}`}
                  card={current === undefined ? null : hiloCardCode(current)}
                  i={0}
                  className={cn("!h-[var(--card-h)]", round?.status === "bust" && "ring-2 ring-loss rounded-[10px]")}
                />
              </AnimatePresence>
            </div>
          </div>

          {/* The run so far: each card with the call made on it. */}
          <div className="flex h-[84px] shrink-0 items-center gap-1.5 overflow-x-auto" aria-label="Cards so far">
            {trail.length === 0 ? (
              <p className="w-full text-center text-[12px] text-fg-muted">
                {playing ? "Higher or lower than this card? Ties win." : "Bet to draw your first card."}
              </p>
            ) : (
              trail.map((t, i) => (
                <div key={i} className="flex shrink-0 flex-col items-center gap-1">
                  <div className="h-[52px]">
                    <PlayingCard card={hiloCardCode(t.card)} i={0} className="!h-[52px]" />
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-semibold",
                      t.pick === "skip" ? "text-fg-muted" : round?.status === "bust" && i === trail.length - 1 ? "text-loss" : "text-win",
                    )}
                  >
                    {t.pick === "higher" ? "▲" : t.pick === "lower" ? "▼" : "skip"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </GameShell>
      <InstantFairness
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        nextCommit={g.nextCommit}
        clientSeed={g.clientSeed}
        last={ended ? round.reveal : null}
        outcomeLabel="Cards verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
