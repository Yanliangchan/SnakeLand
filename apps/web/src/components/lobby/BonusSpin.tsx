"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { SpinResultDTO, SpinStateDTO } from "@snakeland/shared";
import { Button, Sheet } from "@/components/ui";
import { cn } from "@/lib/cn";
import { engagementApi } from "@/lib/engagement-api";
import { useSession } from "@/providers/session";
import { useSettings } from "@/providers/settings";

const WEDGE = ["#f0524b", "#38bdf8", "#facc15", "#a78bfa", "#4ade80", "#fb923c", "#f472b6", "#2dd4bf"];

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The daily bonus wheel: a lobby card that opens a spinner. */
export function BonusSpin() {
  const { setWallet } = useSession();
  const { play } = useSettings();
  const [state, setState] = useState<SpinStateDTO | null>(null);
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResultDTO | null>(null);
  const [angle, setAngle] = useState(0);
  const busy = useRef(false);

  const load = () => engagementApi.spinState().then(setState).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  const segments = state?.segments ?? [];
  const N = segments.length || 8;

  const spin = async () => {
    if (busy.current || !state?.canSpin) return;
    busy.current = true;
    setSpinning(true);
    setResult(null);
    try {
      const r = await engagementApi.spin();
      setWallet({ balance: r.balance });
      // Land the pointer (top) on the winning wedge after several turns.
      const per = 360 / N;
      const target = 360 * 6 - (r.index * per + per / 2);
      setAngle((a) => a + ((target - (a % 360)) % 360) + 360 * 6);
      play("coin");
      setTimeout(() => {
        setResult(r);
        setState((s) => (s ? { ...s, canSpin: false, nextSpinAt: r.nextSpinAt, streak: r.streak } : s));
        play("bigwin");
        setSpinning(false);
        busy.current = false;
      }, 3400);
    } catch {
      setSpinning(false);
      busy.current = false;
      void load();
    }
  };

  if (!state) return null;

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-[var(--radius-card)] px-4 py-3.5 text-left transition-colors hairline sm:px-5",
          state.canSpin ? "bg-[color-mix(in_srgb,#facc15_10%,var(--color-surface))] hover:border-hairline-strong" : "bg-surface",
        )}
      >
        <span className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full text-[18px]" aria-hidden>
            🎡
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Daily spin</span>
            <span className="block truncate text-[12px] text-fg-muted">
              {state.canSpin ? `Free spin ready · day ${state.streak} streak` : `Next spin in ${timeLeft(state.nextSpinAt!)}`}
            </span>
          </span>
        </span>
        {state.canSpin && <span className="rounded-full bg-[#facc15] px-2 py-0.5 text-[11px] font-semibold text-bg">Spin</span>}
      </motion.button>

      <Sheet open={open} onClose={() => setOpen(false)} label="Daily bonus spin" title="Daily spin">
        <div className="flex flex-col items-center gap-4">
          <div className="relative aspect-square w-[min(78vw,320px)]">
            {/* Pointer */}
            <div className="absolute left-1/2 top-[-2px] z-10 -translate-x-1/2" aria-hidden>
              <svg width="24" height="20" viewBox="0 0 24 20">
                <path d="M12 20 L2 2 L22 2 Z" fill="var(--color-fg)" />
              </svg>
            </div>
            <motion.svg
              viewBox="0 0 200 200"
              className="size-full"
              animate={{ rotate: angle }}
              transition={{ duration: 3.4, ease: [0.15, 0.7, 0.2, 1] }}
              role="img"
              aria-label="Bonus wheel"
            >
              {segments.map((amt, i) => {
                const per = 360 / N;
                const a0 = (i * per - 90) * (Math.PI / 180);
                const a1 = ((i + 1) * per - 90) * (Math.PI / 180);
                const x0 = 100 + 96 * Math.cos(a0);
                const y0 = 100 + 96 * Math.sin(a0);
                const x1 = 100 + 96 * Math.cos(a1);
                const y1 = 100 + 96 * Math.sin(a1);
                const mid = (i * per + per / 2 - 90) * (Math.PI / 180);
                const tx = 100 + 62 * Math.cos(mid);
                const ty = 100 + 62 * Math.sin(mid);
                return (
                  <g key={i}>
                    <path d={`M100 100 L${x0} ${y0} A96 96 0 0 1 ${x1} ${y1} Z`} fill={WEDGE[i % WEDGE.length]} opacity="0.9" />
                    <text
                      x={tx}
                      y={ty}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="12"
                      fontWeight="700"
                      fill="#0a0a0a"
                      transform={`rotate(${i * per + per / 2} ${tx} ${ty})`}
                    >
                      {amt >= 1000 ? `${(amt / 1000).toFixed(amt % 1000 ? 1 : 0)}k` : amt}
                    </text>
                  </g>
                );
              })}
              <circle cx="100" cy="100" r="14" fill="var(--color-fg)" />
            </motion.svg>
          </div>

          <AnimatePresence mode="wait">
            {result ? (
              <motion.p key="won" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[16px] font-semibold text-win">
                +{result.amount.toLocaleString()} chips! Day {result.streak} streak
              </motion.p>
            ) : (
              <motion.p key="prompt" className="text-[13px] text-fg-muted">
                {state.canSpin ? `Streak ${state.streak} — bigger streak, bigger wheel` : `Come back in ${timeLeft(state.nextSpinAt!)}`}
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            className="w-full"
            onClick={result ? () => setOpen(false) : spin}
            loading={spinning}
            disabled={!result && (!state.canSpin || spinning)}
          >
            {result ? "Nice!" : state.canSpin ? "Spin" : "Already spun today"}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
