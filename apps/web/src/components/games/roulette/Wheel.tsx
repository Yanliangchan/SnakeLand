"use client";

import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useRef } from "react";
import { WHEEL_ORDER, pocketColor } from "@snakeland/shared";

const STEP = 360 / WHEEL_ORDER.length;
const FILL = { red: "var(--color-table-red)", black: "var(--color-table-black)", zero: "var(--color-table-green)" } as const;
const TEXT = { red: "#FAFAFA", black: "#FAFAFA", zero: "#FAFAFA" } as const;

function wedge(i: number, r1: number, r2: number) {
  const a0 = ((i - 0.5) * STEP - 90) * (Math.PI / 180);
  const a1 = ((i + 0.5) * STEP - 90) * (Math.PI / 180);
  const p = (r: number, a: number) => `${r * Math.cos(a)} ${r * Math.sin(a)}`;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r2, a1)} A ${r2} ${r2} 0 0 0 ${p(r2, a0)} Z`;
}

/** Rotation (deg) that puts the pocket for `n` under the pointer at the top. */
const restAngle = (n: number) => -WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]) * STEP;

/**
 * European wheel. When a result arrives it decelerates onto that pocket over
 * the remaining spin time while the ball orbits the other way and drops into
 * place under the pointer.
 */
export function Wheel({ result, spinning, spinMsLeft }: { result: number | null; spinning: boolean; spinMsLeft: number }) {
  const rotation = useMotionValue(0);
  const ball = useMotionValue(0);
  const lastSpun = useRef<number | null>(null);

  useEffect(() => {
    if (result === null) return;
    const target = restAngle(result);
    if (spinning && spinMsLeft > 600 && lastSpun.current !== result) {
      lastSpun.current = result;
      const from = rotation.get();
      const delta = ((((target - from) % 360) + 360) % 360) + 360 * 4;
      const duration = spinMsLeft / 1000;
      const ease = [0.12, 0.65, 0.2, 1] as const;
      const a = animate(rotation, from + delta, { duration, ease });
      ball.set(-360 * 3);
      const b = animate(ball, 0, { duration, ease });
      return () => {
        a.stop();
        b.stop();
      };
    }
    if (!spinning) {
      // Joined late or reloaded: snap to the result instead of replaying the spin.
      lastSpun.current = result;
      rotation.set(target);
      ball.set(0);
    }
  }, [result, spinning, spinMsLeft, rotation, ball]);

  return (
    <svg viewBox="-110 -118 220 228" className="block size-full" role="img" aria-label={result === null ? "Roulette wheel" : `Roulette wheel, ball on ${result}`}>
      <circle r="106" fill="#0F0F0F" stroke="rgba(255,255,255,0.08)" />
      <motion.g style={{ rotate: rotation }}>
        {WHEEL_ORDER.map((n, i) => {
          const tone = pocketColor(n);
          const a = (i * STEP - 90) * (Math.PI / 180);
          return (
            <g key={n}>
              <path d={wedge(i, 100, 72)} fill={FILL[tone]} stroke="#0A0A0A" strokeWidth="0.6" />
              <text
                x={86 * Math.cos(a)}
                y={86 * Math.sin(a)}
                fill={TEXT[tone]}
                fontSize="8"
                fontWeight="600"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${i * STEP} ${86 * Math.cos(a)} ${86 * Math.sin(a)})`}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {n}
              </text>
            </g>
          );
        })}
        <circle r="72" fill="#121212" stroke="rgba(255,255,255,0.06)" />
        {Array.from({ length: 8 }, (_, i) => (
          <line key={i} x1="0" y1="0" x2={40 * Math.cos((i * Math.PI) / 4)} y2={40 * Math.sin((i * Math.PI) / 4)} stroke="#262626" strokeWidth="2" />
        ))}
        <circle r="14" fill="#1E1E1E" stroke="rgba(255,255,255,0.1)" />
      </motion.g>
      {result !== null && (
        <motion.g style={{ rotate: ball }}>
          <motion.circle cx="0" cy="-66" r="4.2" fill="#FAFAFA" initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,0.6))" }} />
        </motion.g>
      )}
      <path d="M -6 -116 L 6 -116 L 0 -104 Z" fill="#FAFAFA" />
    </svg>
  );
}
