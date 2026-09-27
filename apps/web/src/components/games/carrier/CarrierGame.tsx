"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CARRIER_MODES,
  INSTANT_BET_LIMITS,
  carrierFlight,
  carrierLandChance,
  formatX100,
  type CarrierEventDTO,
  type CarrierFlightDTO,
  type CarrierMode,
} from "@snakeland/shared";
import { GameShell, PanelSection } from "@/components/GameShell";
import { Button, WinCelebration } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { carrierApi } from "@/lib/arcade-api";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";
import { recordRound } from "@/lib/session-stats";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";
import { ChipTray, StakeSummary, useChipSlip } from "../shared/ChipSlip";
import { InstantFairness } from "../shared/InstantFairness";
import { OptionPills } from "../shared/OptionPills";
import { RecentMultipliers, type RecentItem } from "../shared/RecentMultipliers";
import { useClientSeed } from "../shared/useClientSeed";

const MODE_LABEL: Record<CarrierMode, string> = { calm: "Calm", normal: "Normal", fast: "Fast", turbo: "Turbo" };
const PLANE_X = 190;
const PLANE_Y = 190;
const DECK_Y = 356;

type Phase = "idle" | "flying" | "landing" | "done";

function message(e: unknown) {
  if (e instanceof ApiError) return e.code === "INSUFFICIENT_FUNDS" ? "Not enough chips for that." : e.message;
  return "Something went wrong. Try again.";
}

function eventLabel(e: CarrierEventDTO) {
  if (e.kind === "add") return `+${(e.value / 100).toFixed(e.value % 100 ? 1 : 0)}×`;
  if (e.kind === "mul") return `×${e.value}`;
  if (e.kind === "rocket") return "½";
  return "";
}

/** A side-on jet facing right, in local coordinates around (0,0). */
function Jet() {
  return (
    <g>
      <path d="M-46 -4 L28 -9 Q48 -8 54 0 Q48 8 28 9 L-46 6 Z" fill="#e5e7eb" />
      <path d="M36 -7 Q46 -6 50 -2 L38 -2 Z" fill="#60a5fa" />
      <path d="M-4 2 L-22 26 L-10 26 L14 4 Z" fill="#cbd5e1" />
      <path d="M-4 -3 L-18 -18 L-8 -18 L10 -5 Z" fill="#cbd5e1" />
      <path d="M-44 -4 L-54 -26 L-44 -26 L-30 -6 Z" fill="#fb923c" />
      <path d="M-46 -2 L-58 -2" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
    </g>
  );
}

function Pickup({ e, durationMs }: { e: CarrierEventDTO; durationMs: number }) {
  const rocket = e.kind === "rocket";
  const cloud = e.kind === "cloud";
  return (
    <motion.g
      initial={{ x: 900, opacity: 0 }}
      animate={{ x: PLANE_X + 30, opacity: [0, 1, 1, 0.9] }}
      transition={{ duration: durationMs / 1000, ease: "linear" }}
    >
      {cloud ? (
        <g opacity="0.35" transform={`translate(0 ${PLANE_Y - 70})`}>
          <ellipse rx="46" ry="16" fill="#cbd5e1" />
          <ellipse cx="-22" cy="4" rx="28" ry="12" fill="#cbd5e1" />
        </g>
      ) : (
        <g transform={`translate(0 ${PLANE_Y})`}>
          <circle r="30" fill={rocket ? "rgba(212,64,58,0.18)" : "rgba(251,146,60,0.16)"} stroke={rocket ? "#d4403a" : "#fb923c"} strokeWidth="2" />
          {rocket ? (
            <g>
              <path d="M-14 0 L8 -6 L16 0 L8 6 Z" fill="#fafafa" />
              <path d="M-14 0 L-22 -5 M-14 0 L-22 5" stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
              <text y="48" textAnchor="middle" fontSize="20" fontWeight="700" fill="#ff4d4d">½</text>
            </g>
          ) : (
            <text y="8" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fafafa">
              {eventLabel(e)}
            </text>
          )}
        </g>
      )}
    </motion.g>
  );
}

function Carrier({ show }: { show: boolean }) {
  return (
    <motion.g initial={false} animate={{ x: show ? 0 : 460 }} transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}>
      <path d="M440 360 L800 360 L780 404 L470 404 Z" fill="#374151" />
      <rect x="428" y={DECK_Y - 6} width="386" height="10" rx="2" fill="#4b5563" />
      <path d={`M460 ${DECK_Y - 2} L780 ${DECK_Y - 2}`} stroke="#facc15" strokeWidth="2" strokeDasharray="14 10" />
      <rect x="700" y="312" width="34" height="40" rx="3" fill="#6b7280" />
      <rect x="708" y="298" width="4" height="16" fill="#9ca3af" />
      <rect x="706" y="322" width="22" height="6" rx="1" fill="#93c5fd" opacity="0.6" />
    </motion.g>
  );
}

export function CarrierGame() {
  const { me, setWallet } = useSession();
  const { play, speed, reducedMotion } = useSettings();
  const clientSeed = useClientSeed();
  const balance = me?.wallet.balance ?? 0;
  const slip = useChipSlip(Math.min(INSTANT_BET_LIMITS.max, balance));
  const [mode, setMode] = useState<CarrierMode>("normal");
  const [phase, setPhase] = useState<Phase>("idle");
  const [flight, setFlight] = useState<CarrierFlightDTO | null>(null);
  const [shown, setShown] = useState(0);
  const [nextCommit, setNextCommit] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fairOpen, setFairOpen] = useState(false);
  const [last, setLast] = useState<{ flight: CarrierFlightDTO; clientSeed: string } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = useRef(false);

  const stepMs = Math.round(720 * speed);

  useEffect(() => {
    let cancelled = false;
    const pending = timers.current;
    carrierApi
      .state()
      .then((s) => !cancelled && setNextCommit(s.nextCommit))
      .catch(() => {});
    return () => {
      cancelled = true;
      pending.forEach(clearTimeout);
    };
  }, []);

  const fly = useCallback(async () => {
    if (busy.current || phase === "flying" || phase === "landing") return;
    if (slip.amount < INSTANT_BET_LIMITS.min) return setError(`Minimum bet is ${INSTANT_BET_LIMITS.min}.`);
    busy.current = true;
    setError(null);
    const seed = clientSeed.next();
    try {
      const res = await carrierApi.fly({ bet: slip.amount, mode, clientSeed: seed });
      // Show the stake leaving now; the payout lands with the plane.
      setWallet({ balance: res.balance - res.flight.payout });
      setNextCommit(res.nextCommit);
      setFlight(res.flight);
      setShown(0);
      setPhase("flying");
      play("whoosh");
      timers.current.forEach(clearTimeout);
      timers.current.length = 0;
      const n = res.flight.events.length;
      for (let i = 1; i <= n; i++) {
        timers.current.push(
          setTimeout(() => {
            setShown(i);
            const e = res.flight.events[i - 1]!;
            if (e.kind !== "cloud") play(e.kind === "rocket" ? "click" : "flip");
          }, i * stepMs),
        );
      }
      timers.current.push(setTimeout(() => setPhase("landing"), n * stepMs + 150));
      timers.current.push(
        setTimeout(
          () => {
            setPhase("done");
            setWallet({ balance: res.balance });
            recordRound("carrier", res.flight.bet, res.flight.payout);
            setRecent((r) => [{ id: res.flight.id, x100: res.flight.multiplierX100 }, ...r].slice(0, 12));
            setLast({ flight: res.flight, clientSeed: seed });
            if (res.flight.landed) play("coin");
            else play("lose");
            busy.current = false;
          },
          n * stepMs + 150 + Math.round(2000 * speed),
        ),
      );
    } catch (e) {
      setError(message(e));
      busy.current = false;
    }
  }, [phase, slip.amount, mode, clientSeed, setWallet, play, stepMs, speed]);

  // Space / Enter take off; 1–4 pick a speed.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e) => {
      if (fairOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, button, [role=dialog]")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        void fly();
      } else if (/^[1-4]$/.test(e.key) && (phase === "idle" || phase === "done")) {
        setMode(CARRIER_MODES[Number(e.key) - 1]!);
      }
    };
  });
  useEffect(() => {
    const l = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", l);
    return () => window.removeEventListener("keydown", l);
  }, []);

  const inAir = phase === "flying" || phase === "landing";
  const currentX100 = flight ? (shown > 0 ? flight.events[shown - 1]!.x100 : 100) : 100;
  const landed = flight?.landed ?? false;
  const outcomeOk = last
    ? JSON.stringify(carrierFlight(last.flight.reveal.serverSeed, last.clientSeed, last.flight.mode).events) ===
      JSON.stringify(last.flight.events)
    : null;

  // Where the plane goes at the end: onto the deck, or past it into the sea.
  const planeAnim =
    phase === "landing" || phase === "done"
      ? landed
        ? { x: [PLANE_X, 440, 560, 640], y: [PLANE_Y, 300, DECK_Y - 16, DECK_Y - 16], rotate: [0, 12, 0, 0] }
        : { x: [PLANE_X, 480, 730, 790], y: [PLANE_Y, 290, 420, 470], rotate: [0, 18, 40, 55] }
      : { x: PLANE_X, y: PLANE_Y, rotate: 0 };

  return (
    <>
      <GameShell
        game="carrier"
        title="Carrier"
        tableId="carrier"
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
                <StakeSummary slip={slip} limit={Math.min(INSTANT_BET_LIMITS.max, balance)} disabled={inAir} />
                <ChipTray slip={slip} disabled={inAir} />
              </PanelSection>
              <PanelSection label="Speed" className="@4xl:w-72">
                <OptionPills options={CARRIER_MODES} value={mode} onChange={setMode} label={(m) => MODE_LABEL[m]} disabled={inAir} />
                <p className="mt-1.5 text-[12px] text-fg-muted tabular">
                  {Math.round(carrierLandChance(mode) * 100)}% landing chance · 97% return
                </p>
              </PanelSection>
              <Button size="lg" className="@4xl:w-44" onClick={fly} disabled={inAir || slip.amount < INSTANT_BET_LIMITS.min}>
                {inAir ? "In flight…" : "Take off"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex h-full flex-col gap-2 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <RecentMultipliers items={recent} />
            <button
              onClick={() => setFairOpen(true)}
              className="shrink-0 rounded-full px-3 py-1 text-[12px] text-fg-muted transition-colors hairline hover:text-fg"
            >
              Fair
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-[#0b1220] hairline">
            <svg viewBox="0 0 820 500" preserveAspectRatio="xMidYMax meet" className="absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#0b1220" />
                  <stop offset="0.75" stopColor="#111827" />
                </linearGradient>
                <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#0c2a43" />
                  <stop offset="1" stopColor="#06121f" />
                </linearGradient>
              </defs>
              <rect width="820" height="500" fill="url(#sky)" />
              {[[90, 60], [300, 110], [520, 50], [700, 140], [780, 70], [400, 30]].map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="#fafafa" opacity="0.5" />
              ))}
              <rect y="380" width="820" height="120" fill="url(#sea)" />
              <g className={reducedMotion ? "" : "animate-[waves_6s_linear_infinite]"}>
                {[395, 425, 460].map((y, i) => (
                  <path
                    key={y}
                    d={`M-200 ${y} q 25 -6 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0`}
                    fill="none"
                    stroke="#60a5fa"
                    strokeOpacity={0.18 - i * 0.04}
                    strokeWidth="2"
                  />
                ))}
              </g>

              <Carrier show={phase === "landing" || phase === "done"} />

              {flight && phase === "flying" &&
                flight.events.map((e, i) =>
                  i === shown ? <Pickup key={`${flight.id}-${i}`} e={e} durationMs={stepMs} /> : null,
                )}

              <motion.g
                key={flight?.id ?? "idle"}
                initial={false}
                animate={planeAnim}
                transition={
                  phase === "landing" || phase === "done"
                    ? { duration: 2 * speed * 0.85, ease: "easeInOut", times: [0, 0.45, 0.8, 1] }
                    : { duration: 0.3 }
                }
              >
                <motion.g
                  animate={inAir && phase === "flying" && !reducedMotion ? { y: [0, -6, 0, 5, 0] } : { y: 0 }}
                  transition={{ duration: 2.2, repeat: inAir ? Infinity : 0, ease: "easeInOut" }}
                >
                  <Jet />
                </motion.g>
              </motion.g>

              {phase === "done" && !landed && (
                <motion.g initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 1.6] }} transition={{ duration: 1.2 }}>
                  <circle cx="790" cy="460" r="30" fill="none" stroke="#93c5fd" strokeWidth="3" />
                  <circle cx="790" cy="460" r="50" fill="none" stroke="#93c5fd" strokeWidth="2" opacity="0.6" />
                </motion.g>
              )}
            </svg>

            <div className="pointer-events-none absolute inset-x-0 top-4 flex flex-col items-center">
              <WinCelebration
                trigger={phase === "done" && landed ? flight!.id : null}
                multiplier={phase === "done" && landed ? flight!.multiplierX100 / 100 : 0}
              >
                <p
                  className={cn(
                    "text-[clamp(34px,9cqw,64px)] font-semibold leading-none tracking-[-0.04em] tabular",
                    phase === "done" ? (landed ? "text-win" : "text-loss") : "text-fg",
                  )}
                >
                  {formatX100(currentX100)}
                </p>
              </WinCelebration>
              <p className="mt-1.5 h-5 text-[14px] text-fg-muted">
                {phase === "idle" && "Ready for takeoff"}
                {phase === "flying" && "Collecting boosts…"}
                {phase === "landing" && "Approaching the carrier…"}
                {phase === "done" &&
                  flight &&
                  (landed ? (
                    <span className="text-win">Landed · +{(flight.payout - flight.bet).toLocaleString()}</span>
                  ) : (
                    <span className="text-loss">Splashdown · −{flight.bet.toLocaleString()}</span>
                  ))}
              </p>
            </div>
          </div>
        </div>
      </GameShell>
      <InstantFairness
        open={fairOpen}
        onClose={() => setFairOpen(false)}
        nextCommit={nextCommit}
        clientSeed={clientSeed}
        last={last?.flight.reveal ?? null}
        outcomeLabel="Flight verified"
        outcomeOk={outcomeOk}
      />
    </>
  );
}
