"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { WIDTH, bucketLabel, geometry } from "./geometry";

export interface Ball {
  id: string;
  path: (0 | 1)[];
}

/** Grayscale by payout: the bigger the multiplier, the brighter the bucket. */
function bucketTone(x100: number, max: number) {
  if (x100 < 100) return { fill: "#171717", text: "#8A8A8A" };
  const t = Math.log(x100 / 100 + 1) / Math.log(max / 100 + 1);
  const v = Math.round(0x26 + (0xfa - 0x26) * t);
  const hex = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
  return { fill: hex, text: v > 0x90 ? "#0A0A0A" : "#FAFAFA" };
}

function BallView({ ball, rows, onLand }: { ball: Ball; rows: number; onLand: (id: string) => void }) {
  const g = useMemo(() => geometry(rows), [rows]);
  const { xs, ys } = useMemo(() => g.path(ball.path), [g, ball.path]);
  const n = xs.length - 1;
  // First fall is longer; each row is a quick hop up then a drop onto the next peg.
  const weights = [2.2, ...Array.from({ length: n - 1 }, (_, i) => (i % 2 === 0 ? 0.7 : 1))];
  const total = weights.reduce((a, b) => a + b, 0);
  const times = [0];
  for (const w of weights) times.push(times.at(-1)! + w / total);
  const ease = weights.map((_, i) => (i === 0 ? "easeIn" : i % 2 === 1 ? "easeOut" : "easeIn"));

  return (
    <motion.circle
      r={g.ballR}
      fill="#FAFAFA"
      initial={{ cx: xs[0], cy: ys[0], opacity: 0 }}
      animate={{ cx: xs, cy: ys, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.55 + rows * 0.14, times, ease, opacity: { duration: 0.1 } }}
      onAnimationComplete={() => onLand(ball.id)}
      style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.35))" }}
    />
  );
}

export function Board({
  rows,
  table,
  balls,
  hits,
  onLand,
}: {
  rows: number;
  table: readonly number[];
  balls: Ball[];
  /** Per-bucket landing counter; a change pulses that bucket. */
  hits: number[];
  onLand: (id: string) => void;
}) {
  const g = useMemo(() => geometry(rows), [rows]);
  const max = Math.max(...table);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${g.height}`} className="block w-full" role="img" aria-label={`Plinko board, ${rows} rows`}>
      <AnimatePresence mode="wait">
        <motion.g key={rows} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {g.pegs.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={g.pegR} fill="#525252" />
          ))}
          {g.buckets.map((b, k) => {
            const tone = bucketTone(table[k]!, max);
            return (
              <motion.g
                key={`${k}-${hits[k] ?? 0}`}
                initial={{ y: hits[k] ? g.s * 0.16 : 0 }}
                animate={{ y: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 14 }}
              >
                <rect x={b.x - b.w / 2} y={g.bucketY} width={b.w} height={g.bucketH} rx={g.s * 0.14} fill={tone.fill} />
                <text
                  x={b.x}
                  y={g.bucketY + g.bucketH / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={g.s * (rows > 13 ? 0.24 : 0.27)}
                  fontWeight={600}
                  fill={tone.text}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {bucketLabel(table[k]!)}
                </text>
              </motion.g>
            );
          })}
        </motion.g>
      </AnimatePresence>
      <AnimatePresence>
        {balls.map((b) => (
          <BallView key={b.id} ball={b} rows={rows} onLand={onLand} />
        ))}
      </AnimatePresence>
    </svg>
  );
}
