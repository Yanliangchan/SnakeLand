"use client";

import { useEffect, useState } from "react";
import { GAMES, isGameId, type PublicProfileDTO } from "@snakeland/shared";
import { Avatar, Sheet } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips, dateShort, signedChips } from "@/lib/format";
import { PlayerName } from "./PlayerName";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "win" | "loss" }) {
  return (
    <div className="rounded-[12px] bg-bg/50 p-3 hairline">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{label}</p>
      <p className={cn("mt-1 truncate text-[17px] font-semibold tabular", tone === "win" && "text-win", tone === "loss" && "text-loss")}>
        {value}
      </p>
      {sub && <p className="text-[12px] text-fg-muted">{sub}</p>}
    </div>
  );
}

const tone = (n: number) => (n > 0 ? "win" : n < 0 ? "loss" : undefined);

/** Another player's public card: titles and stats, no balance or email. */
export function PlayerCardSheet({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [data, setData] = useState<{ id: string; card: PublicProfileDTO | null; error?: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api<PublicProfileDTO>(`/v1/players/${encodeURIComponent(userId)}`)
      .then((card) => !cancelled && setData({ id: userId, card }))
      .catch((e) => !cancelled && setData({ id: userId, card: null, error: e instanceof ApiError && e.status === 404 ? "This player isn't visible." : "Couldn't load this player." }));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = data && data.id === userId ? data : null;
  const p = current?.card;
  const fav = p?.stats.favouriteGame;

  return (
    <Sheet
      open={userId !== null}
      onClose={onClose}
      label="Player"
      title={
        p ? (
          <div className="flex items-center gap-3">
            <Avatar name={p.user.name} className="size-11 text-[15px]" />
            <div className="min-w-0">
              <p className="text-[18px] font-semibold">
                <PlayerName tag={p.user} />
              </p>
              <p className="text-[12px] text-fg-muted">Joined {dateShort(p.user.joinedAt)}</p>
            </div>
          </div>
        ) : (
          <p className="text-[18px] font-semibold">Player</p>
        )
      }
    >
      {!current ? (
        <p className="py-8 text-center text-[13px] text-fg-muted">Loading…</p>
      ) : !p ? (
        <p className="py-8 text-center text-[13px] text-fg-muted">{current.error}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="This week"
            value={signedChips(p.stats.weeklyProfit)}
            sub={p.stats.weeklyRank ? `#${p.stats.weeklyRank}` : "Unranked"}
            tone={tone(p.stats.weeklyProfit)}
          />
          <Stat
            label="All time"
            value={signedChips(p.stats.allTimeProfit)}
            sub={p.stats.allTimeRank ? `#${p.stats.allTimeRank}` : "Unranked"}
            tone={tone(p.stats.allTimeProfit)}
          />
          <Stat label="Biggest win" value={chips(p.stats.biggestWin)} />
          <Stat label="Wagered" value={chips(p.stats.totalWagered)} />
          <Stat label="Rounds" value={chips(p.stats.roundsPlayed)} />
          <Stat label="Favourite" value={fav && isGameId(fav) ? GAMES[fav].name : "—"} />
        </div>
      )}
    </Sheet>
  );
}
