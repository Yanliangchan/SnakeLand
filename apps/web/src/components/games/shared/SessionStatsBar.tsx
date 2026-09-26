"use client";

import type { GameId } from "@snakeland/shared";
import { cn } from "@/lib/cn";
import { resetSessionStats, useSessionStats } from "@/lib/session-stats";

const fmt = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`;

/** "This session" summary for one game, at the foot of the control panel. */
export function SessionStatsBar({ game }: { game: GameId }) {
  const s = useSessionStats(game);
  if (s.rounds === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-x-4 gap-y-1 border-t border-hairline pt-2 text-[12px] text-fg-muted tabular lg:mt-3 lg:pt-3">
      <span className="hidden text-[11px] font-medium uppercase tracking-[0.08em] @md:inline">Session</span>
      <span>
        <span className="text-fg">{s.rounds}</span> {s.rounds === 1 ? "round" : "rounds"}
      </span>
      <span className="hidden @xs:inline">
        Wagered <span className="text-fg">{s.wagered.toLocaleString()}</span>
      </span>
      <span>
        Net <span className={cn(s.net > 0 ? "text-win" : s.net < 0 ? "text-loss" : "text-fg")}>{fmt(s.net)}</span>
      </span>
      {s.best > 0 && (
        <span className="hidden @sm:inline">
          Best <span className="text-fg">{s.best.toFixed(2)}×</span>
        </span>
      )}
      <button onClick={() => resetSessionStats(game)} className="ml-auto text-fg-disabled transition-colors hover:text-fg">
        Reset
      </button>
    </div>
  );
}
