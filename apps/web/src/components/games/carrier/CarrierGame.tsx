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
const PLANE_X = 210;
const DECK_Y = 356;
const SEA_Y = 380;

/** Altitude for a multiplier: 1× flies low, and it climbs (up to a cap) as the multiplier grows. */
function altitudeFor(x100: number): number {
  const climb = Math.min(210, Math.max(0, Math.log2(Math.max(1, x100 / 100)) * 66));
  return 300 - climb;
}

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

/** A sleek side-on fighter jet facing right, in local coordinates around (0,0). */
function Jet({ burn }: { burn: boolean }) {
  return (
    <g>
      {/* Afterburner flame, brighter at speed. */}
      <motion.g
        animate={burn ? { scaleX: [1, 1.5, 0.9, 1.3, 1], opacity: [0.85, 1, 0.7, 1, 0.85] } : { scaleX: 1, opacity: 0.5 }}
        transition={{ duration: 0.28, repeat: burn ? Infinity : 0, ease: "easeInOut" }}
        style={{ originX: "-52px", originY: "0px" }}
      >
        <path d="M-52 -4 L-84 0 L-52 4 Z" fill="#fb923c" />
        <path d="M-52 -2.5 L-72 0 L-52 2.5 Z" fill="#fde68a" />
      </motion.g>
      {/* Fuselage */}
      <path d="M-52 0 Q-40 -8 8 -9 L44 -7 Q60 -6 64 0 Q60 6 44 7 L8 9 Q-40 8 -52 0 Z" fill="#e8edf2" />
      <path d="M44 -7 Q60 -6 64 0 Q60 6 44 7 Z" fill="#c2ccd6" />
      {/* Canopy */}
      <path d="M18 -8 Q32 -12 44 -7 L44 -3 Q30 -7 20 -4 Z" fill="#6cb2ea" />
      <path d="M20 -6 Q30 -9 40 -6 L40 -4 Q30 -6 22 -4 Z" fill="#bfe0f7" opacity="0.7" />
      {/* Swept wing + tail fin */}
      <path d="M-6 3 L-32 25 L-14 25 L16 5 Z" fill="#cbd5e1" />
      <path d="M-46 -3 L-58 -28 L-46 -25 L-28 -5 Z" fill="#cbd5e1" />
      {/* Intake + accent stripe */}
      <path d="M-8 4 L2 4 L2 8 L-10 8 Z" fill="#7b8794" />
      <path d="M-30 -1 L30 -2 L30 1 L-30 2 Z" fill="#fb923c" opacity="0.85" />
    </g>
  );
}

function Pickup({ e, durationMs, y }: { e: CarrierEventDTO; durationMs: number; y: number }) {
  const rocket = e.kind === "rocket";
  const cloud = e.kind === "cloud";
  return (
    <motion.g
      initial={{ x: 900, opacity: 0 }}
      animate={{ x: PLANE_X + 30, opacity: [0, 1, 1, 0.9] }}
      transition={{ duration: durationMs / 1000, ease: "linear" }}
    >
      {cloud ? (
        <g opacity="0.4" transform={`translate(0 ${y - 64})`}>
          <ellipse rx="46" ry="16" fill="#cbd5e1" />
          <ellipse cx="-22" cy="4" rx="28" ry="12" fill="#cbd5e1" />
          <ellipse cx="20" cy="2" rx="24" ry="11" fill="#dfe6ee" />
        </g>
      ) : (
        <g transform={`translate(0 ${y})`}>
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
    <motion.g initial={false} animate={{ x: show ? 0 : 480, opacity: show ? 1 : 0 }} transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}>
      {/* Hull */}
      <path d="M436 358 L806 358 L784 410 L474 410 Z" fill="#2f3945" />
      <path d="M436 358 L806 358 L802 366 L440 366 Z" fill="#3b4655" />
      {/* Flight deck */}
      <rect x="428" y={DECK_Y - 7} width="392" height="12" rx="2" fill="#525d6b" />
      {/* Centreline + touchdown markings */}
      <path d={`M452 ${DECK_Y - 1} L792 ${DECK_Y - 1}`} stroke="#e5e7eb" strokeWidth="2" strokeDasharray="20 14" opacity="0.75" />
      <path d={`M560 ${DECK_Y - 4} L560 ${DECK_Y + 2} M588 ${DECK_Y - 4} L588 ${DECK_Y + 2} M616 ${DECK_Y - 4} L616 ${DECK_Y + 2}`} stroke="#facc15" strokeWidth="3" />
      {/* Arrestor wires */}
      {[636, 664, 692].map((x) => (
        <path key={x} d={`M${x} ${DECK_Y - 5} L${x} ${DECK_Y - 1}`} stroke="#cbd5e1" strokeWidth="1.5" opacity="0.8" />
      ))}
      {/* Island tower with lights */}
      <rect x="726" y="308" width="40" height="48" rx="3" fill="#616c7a" />
      <rect x="734" y="292" width="4" height="18" fill="#8b95a3" />
      <circle cx="736" cy="292" r="3" fill="#f0524b">
        <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <rect x="732" y="320" width="26" height="7" rx="1" fill="#93c5fd" opacity="0.6" />
      <rect x="732" y="332" width="26" height="7" rx="1" fill="#93c5fd" opacity="0.4" />
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
  const prevX100 = flight && shown > 1 ? flight.events[shown - 2]!.x100 : 100;
  const altitude = altitudeFor(currentX100);
  const landed = flight?.landed ?? false;
  const outcomeOk = last
    ? JSON.stringify(carrierFlight(last.flight.reveal.serverSeed, last.clientSeed, last.flight.mode).events) ===
      JSON.stringify(last.flight.events)
    : null;

  // Bank angle: nose up while climbing, nose down on a dip.
  const bank =
    phase === "landing" || phase === "done"
      ? landed
        ? 0
        : 60
      : Math.max(-16, Math.min(10, (altitudeFor(prevX100) - altitude) / 4));

  // The plane holds station while collecting, then rises/dips with the multiplier,
  // and finally banks down onto the deck or overshoots into the sea.
  const planePos =
    phase === "landing" || phase === "done"
      ? landed
        ? { x: [PLANE_X, 470, 600, 662], y: [altitude, 300, DECK_Y - 18, DECK_Y - 18] }
        : { x: [PLANE_X, 500, 748, 806], y: [altitude, 322, 432, 482] }
      : { x: PLANE_X, y: altitude };

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
                  i === shown ? <Pickup key={`${flight.id}-${i}`} e={e} durationMs={stepMs} y={altitude} /> : null,
                )}

              <motion.g
                key={flight?.id ?? "idle"}
                initial={false}
                animate={planePos}
                transition={
                  phase === "landing" || phase === "done"
                    ? { duration: 2 * speed * 0.85, ease: "easeInOut", times: [0, 0.45, 0.8, 1] }
                    : { duration: 0.5, ease: "easeInOut" }
                }
              >
                {/* Banking jet with a gentle idle bob. */}
                <motion.g animate={{ rotate: bank }} transition={{ duration: phase === "flying" ? 0.5 : 0.9, ease: "easeOut" }}>
                  <motion.g
                    animate={inAir && phase === "flying" && !reducedMotion ? { y: [0, -5, 0, 4, 0] } : { y: 0 }}
                    transition={{ duration: 2.4, repeat: inAir && phase === "flying" ? Infinity : 0, ease: "easeInOut" }}
                  >
                    <Jet burn={inAir && !reducedMotion} />
                  </motion.g>
                </motion.g>
                {/* Multiplier tag riding just above the plane (stays upright). */}
                {inAir && (
                  <g transform="translate(6 -30)">
                    <rect x="-30" y="-15" width="60" height="24" rx="12" fill="rgba(11,18,32,0.82)" stroke="#fb923c" strokeWidth="1.5" />
                    <text x="0" y="2" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fde68a">
                      {formatX100(currentX100)}
                    </text>
                  </g>
                )}
              </motion.g>

              {/* Splash plume where the plane hits the sea. */}
              {phase === "done" && !landed && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.3 }}>
                  <motion.g
                    initial={{ y: 10, scaleY: 0.3 }}
                    animate={{ y: [10, -26, 6], scaleY: [0.3, 1, 0.5] }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                  >
                    {[-18, -6, 6, 18].map((dx, i) => (
                      <ellipse key={dx} cx={806 + dx} cy={SEA_Y + 8} rx={5 - i * 0.4} ry={14 - Math.abs(dx) / 3} fill="#bfe0f7" opacity="0.85" />
                    ))}
                  </motion.g>
                  <circle cx="806" cy={SEA_Y + 12} r="26" fill="none" stroke="#93c5fd" strokeWidth="3" />
                  <circle cx="806" cy={SEA_Y + 12} r="46" fill="none" stroke="#93c5fd" strokeWidth="2" opacity="0.5" />
                </motion.g>
              )}

              {/* Touchdown puff on the deck. */}
              {phase === "done" && landed && !reducedMotion && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0, 0.7, 0] }} transition={{ duration: 0.8 }}>
                  <ellipse cx="640" cy={DECK_Y - 4} rx="30" ry="7" fill="#e5e7eb" opacity="0.5" />
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
