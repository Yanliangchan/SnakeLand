"use client";

import { animate, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { useEffect, useRef } from "react";
import { WHEEL_ORDER, pocketColor } from "@snakeland/shared";

const STEP = 360 / WHEEL_ORDER.length;
const FILL = { red: "var(--color-table-red)", black: "var(--color-table-black)", zero: "var(--color-table-green)" } as const;
const TEXT = { red: "#FAFAFA", black: "#FAFAFA", zero: "#FAFAFA" } as const;

/** Ball track radii: it starts high on the rim and drops into the pockets. */
const BALL_RIM = 95;
const BALL_POCKET = 66;

function wedge(i: number, r1: number, r2: number) {
  const a0 = ((i - 0.5) * STEP - 90) * (Math.PI / 180);
  const a1 = ((i + 0.5) * STEP - 90) * (Math.PI / 180);
  const p = (r: number, a: number) => `${r * Math.cos(a)} ${r * Math.sin(a)}`;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r2, a1)} A ${r2} ${r2} 0 0 0 ${p(r2, a0)} Z`;
}

/** Rotation (deg) that puts the pocket for `n` under the pointer at the top. */
const restAngle = (n: number) => -WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]) * STEP;

/**
 * The wheel's moving parts, owned by the caller so the wheel can move between
 * the table and the full-size spotlight without losing its place mid-spin.
 */
export interface WheelMotion {
  rotation: MotionValue<number>;
  ball: MotionValue<number>;
  ballRadius: MotionValue<number>;
  /** The round the wheel last spun (or snapped) to. */
  lastSpunRef: { current: string | null };
  /** The running spin, so a new one can stop it. It outlives the wheel's own mount. */
  spinRef: { current: { stop: () => void }[] };
}

export function useWheelMotion(): WheelMotion {
  const rotation = useMotionValue(0);
  const ball = useMotionValue(0);
  const ballRadius = useMotionValue(BALL_POCKET);
  const lastSpunRef = useRef<string | null>(null);
  const spinRef = useRef<{ stop: () => void }[]>([]);
  return { rotation, ball, ballRadius, lastSpunRef, spinRef };
}

/**
 * European wheel. When a result arrives it decelerates onto that pocket over
 * the remaining spin time while the ball orbits the other way, high on the
 * rim, then drops and bounces into place under the pointer. `landed` lights
 * up the winning pocket and shows the number in the hub.
 */
export function Wheel({
  motion: m,
  roundId,
  result,
  spinning,
  spinEndsAt,
  clockOffset,
  landed,
  onTick,
}: {
  motion: WheelMotion;
  roundId: string | null;
  result: number | null;
  spinning: boolean;
  /** When the spin ends (server time), and the server clock's offset from this one. */
  spinEndsAt: string | null;
  clockOffset: { current: number };
  landed: boolean;
  /** Called as pockets pass the pointer, slowing with the wheel. */
  onTick?: () => void;
}) {
  const { rotation, ball, ballRadius, lastSpunRef, spinRef } = m;
  const ballY = useTransform(ballRadius, (r) => -r);
  const tick = useRef(onTick);
  useEffect(() => {
    tick.current = onTick;
  });

  // Start the spin once per result. The animations belong to the caller, so
  // they keep running through re-renders and when the wheel moves on screen.
  useEffect(() => {
    if (result === null || !roundId || lastSpunRef.current === roundId) return;
    const target = restAngle(result);
    // Time left, read from the server deadline right now (never a stale countdown).
    const msLeft = spinEndsAt ? Date.parse(spinEndsAt) - (Date.now() + clockOffset.current) : 0;
    if (spinning && msLeft > 600) {
      lastSpunRef.current = roundId;
      for (const a of spinRef.current) a.stop();
      const from = rotation.get();
      const delta = ((((target - from) % 360) + 360) % 360) + 360 * 5;
      const duration = msLeft / 1000;
      const ease = [0.12, 0.65, 0.2, 1] as const;
      ball.set(-360 * 4);
      ballRadius.set(BALL_RIM);
      spinRef.current = [
        animate(rotation, from + delta, { duration, ease }),
        animate(ball, 0, { duration, ease }),
        // Rides the rim, drops off it, then rattles between pockets before settling.
        animate(ballRadius, [BALL_RIM, BALL_RIM, 78, 70, BALL_POCKET + 3, BALL_POCKET, BALL_POCKET + 1.5, BALL_POCKET], {
          duration,
          times: [0, 0.55, 0.68, 0.76, 0.84, 0.9, 0.95, 1],
          ease: "easeOut",
        }),
      ];
    } else if (!spinning) {
      // Joined late or reloaded: snap to the result instead of replaying the spin.
      lastSpunRef.current = roundId;
      rotation.set(target);
      ball.set(0);
      ballRadius.set(BALL_POCKET);
    }
  }, [roundId, result, spinning, spinEndsAt, clockOffset, rotation, ball, ballRadius, lastSpunRef, spinRef]);

  // Once the result is up the wheel must sit on it: if the spin ran long (a
  // throttled background tab, a clock jump), ease it onto the right pocket.
  useEffect(() => {
    if (spinning || result === null || lastSpunRef.current !== roundId) return;
    const target = restAngle(result);
    const now = rotation.get();
    const off = ((((now - target) % 360) + 540) % 360) - 180;
    if (Math.abs(off) < 0.5 && Math.abs(ball.get()) < 0.5) return;
    for (const a of spinRef.current) a.stop();
    spinRef.current = [
      animate(rotation, now - off, { duration: 0.5, ease: "easeOut" }),
      animate(ball, 0, { duration: 0.5, ease: "easeOut" }),
      animate(ballRadius, BALL_POCKET, { duration: 0.3 }),
    ];
  }, [spinning, result, roundId, rotation, ball, ballRadius, lastSpunRef, spinRef]);

  // A soft click each time a pocket passes the pointer (at most every 55 ms).
  useEffect(() => {
    if (!spinning) return;
    let pocket = Math.floor(rotation.get() / STEP);
    let lastTick = 0;
    return rotation.on("change", (v) => {
      const p = Math.floor(v / STEP);
      const now = performance.now();
      if (p !== pocket && now - lastTick > 55) {
        lastTick = now;
        tick.current?.();
      }
      pocket = p;
    });
  }, [spinning, rotation]);

  const tone = result === null ? null : pocketColor(result);

  return (
    <svg viewBox="-110 -118 220 228" className="block size-full" role="img" aria-label={result === null ? "Roulette wheel" : `Roulette wheel, ball on ${result}`}>
      <circle r="106" fill="#0F0F0F" stroke="rgba(255,255,255,0.08)" />
      <motion.g style={{ rotate: rotation }}>
        {WHEEL_ORDER.map((n, i) => {
          const pocketTone = pocketColor(n);
          const a = (i * STEP - 90) * (Math.PI / 180);
          return (
            <g key={n}>
              <path d={wedge(i, 100, 72)} fill={FILL[pocketTone]} stroke="#0A0A0A" strokeWidth="0.6" />
              <text
                x={86 * Math.cos(a)}
                y={86 * Math.sin(a)}
                fill={TEXT[pocketTone]}
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

      {/* The winning pocket (always under the pointer once landed) lights up. */}
      {landed && (
        <motion.path
          d={wedge(0, 101, 71)}
          fill="none"
          stroke="#FAFAFA"
          strokeWidth="2"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.45, 1, 0.45, 1] }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
          style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.8))" }}
        />
      )}

      {result !== null && (
        <motion.g style={{ rotate: ball }}>
          <motion.circle
            cx="0"
            cy={ballY}
            r="4.2"
            fill="#FAFAFA"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,0.6))" }}
          />
        </motion.g>
      )}

      {/* The number pops up in the hub when the ball settles. */}
      {landed && result !== null && tone && (
        <motion.g
          key={result}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
        >
          <circle r="34" fill={FILL[tone]} stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
          <text
            fill="#FAFAFA"
            fontSize="30"
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {result}
          </text>
        </motion.g>
      )}
      <path d="M -6 -116 L 6 -116 L 0 -104 Z" fill="#FAFAFA" />
    </svg>
  );
}
