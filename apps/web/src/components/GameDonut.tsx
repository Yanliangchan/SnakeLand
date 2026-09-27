"use client";

import { GAMES, isGameId } from "@snakeland/shared";
import { GAME_ACCENT } from "@/lib/games-ui";

/** A donut of rounds-per-game, most-played first. Grey fallback for unknown games. */
export function GameDonut({ breakdown }: { breakdown: { game: string; rounds: number }[] }) {
  const top = breakdown.slice(0, 6);
  const total = top.reduce((s, g) => s + g.rounds, 0);
  if (total === 0) return <p className="py-8 text-center text-[13px] text-fg-muted">No rounds yet. Go play a few.</p>;

  const R = 42;
  const C = 2 * Math.PI * R;
  const fracs = top.map((g) => g.rounds / total);
  const arcs = top.map((g, i) => {
    const frac = fracs[i]!;
    const start = fracs.slice(0, i).reduce((a, b) => a + b, 0);
    return {
      colour: isGameId(g.game) ? GAME_ACCENT[g.game] : "#8a8a8a",
      dash: frac * C,
      gap: C - frac * C,
      offset: -start * C,
      name: isGameId(g.game) ? GAMES[g.game].name : g.game,
      frac,
    };
  });

  return (
    <div className="flex items-center gap-5">
      <svg width="112" height="112" viewBox="0 0 112 112" className="shrink-0" role="img" aria-label="Rounds by game">
        {/* Arcs start at 12 o'clock; only this group is rotated, so the labels stay upright. */}
        <g transform="rotate(-90 56 56)">
          <circle cx="56" cy="56" r={R} fill="none" stroke="var(--color-elevated)" strokeWidth="12" />
          {arcs.map((a) => (
            <circle
              key={a.name}
              cx="56"
              cy="56"
              r={R}
              fill="none"
              stroke={a.colour}
              strokeWidth="12"
              strokeDasharray={`${a.dash} ${a.gap}`}
              strokeDashoffset={a.offset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        <text x="56" y="53" textAnchor="middle" fontSize="19" fontWeight="700" fill="var(--color-fg)">
          {total}
        </text>
        <text x="56" y="68" textAnchor="middle" fontSize="9" fill="var(--color-fg-muted)">
          rounds
        </text>
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {arcs.map((a) => (
          <li key={a.name} className="flex items-center gap-2 text-[13px]">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.colour }} />
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            <span className="tabular text-fg-muted">{Math.round(a.frac * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
