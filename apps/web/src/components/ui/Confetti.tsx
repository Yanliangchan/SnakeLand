"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useSettings } from "@/providers/settings";

const COLOURS = ["#facc15", "#f0524b", "#38bdf8", "#4ade80", "#a78bfa", "#fb923c", "#fde047"];

interface Piece {
  x: number;
  y: number;
  rot: number;
  colour: string;
  coin: boolean;
  delay: number;
}

function build(intensity: number): Piece[] {
  const n = Math.min(60, Math.round(22 * intensity));
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI * 2 * (i / n) + Math.random();
    const dist = 120 + Math.random() * 220 * Math.min(2, intensity);
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist - 60,
      rot: Math.random() * 720 - 360,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)]!,
      coin: Math.random() < 0.4,
      delay: Math.random() * 0.12,
    };
  });
}

/** One burst; remounts (fresh pieces) whenever the parent changes its key. */
function Burst({ intensity }: { intensity: number }) {
  const [pieces] = useState(() => build(intensity));
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 1600);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <motion.div
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{ x: p.x, y: [p.y, p.y + 260], opacity: [1, 1, 0], rotate: p.rot, scale: 0.9 }}
          transition={{ duration: 1.3, delay: p.delay, ease: [0.2, 0.7, 0.3, 1] }}
          className="absolute"
          style={{ color: p.colour }}
        >
          {p.coin ? (
            <span className="block size-3 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
          ) : (
            <span className="block h-3 w-1.5 rounded-[1px] bg-current" />
          )}
        </motion.div>
      ))}
    </div>
  );
}

/**
 * A one-shot confetti + coin burst from the centre. Each new `fire` value
 * triggers a burst sized by `intensity`. Silent on reduced motion.
 */
export function Confetti({ fire, intensity = 1 }: { fire: string | number | null; intensity?: number }) {
  const { reducedMotion } = useSettings();
  if (fire === null || reducedMotion) return null;
  return <Burst key={fire} intensity={intensity} />;
}
