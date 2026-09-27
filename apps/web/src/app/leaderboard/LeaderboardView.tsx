"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  ALL_TIME_PERKS,
  HALL_OF_FAME_SIZE,
  LAST_PLACE_TITLE,
  WEEKLY_TITLES,
  type LeaderboardDTO,
  type LeaderboardEntryDTO,
  type LeaderboardKind,
} from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState, ErrorState } from "@/components/ErrorState";
import { PlayerCardSheet } from "@/components/PlayerCard";
import { NAME_COLOUR, PlayerName, TitleBadge } from "@/components/PlayerName";
import { Segmented } from "@/components/Segmented";
import { ListSkeleton } from "@/components/Skeleton";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { signedChips, timeLeft } from "@/lib/format";
import { expoOut, fadeUp, tableSwitch } from "@/lib/motion";
import { useSession } from "@/providers/session";

const MEDAL = ["bg-gold text-bg", "bg-silver text-bg", "bg-bronze text-bg"];

function RankDot({ rank, className }: { rank: number; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular",
        MEDAL[rank - 1] ?? "bg-elevated text-fg-muted hairline",
        className,
      )}
    >
      {rank}
    </span>
  );
}

function Podium({ entries, onOpen }: { entries: LeaderboardEntryDTO[]; onOpen: (userId: string) => void }) {
  // Visual order 2 · 1 · 3, the winner raised in the middle.
  const order = [entries[1], entries[0], entries[2]];
  const heights = ["h-20", "h-28", "h-16"];
  return (
    <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
      {order.map((e, i) => (
        <motion.div
          key={e?.rank ?? `empty-${i}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: expoOut, delay: [0.07, 0, 0.14][i] }}
          className="flex min-w-0 flex-col items-center text-center"
        >
          {e ? (
            <button onClick={() => onOpen(e.userId)} className="flex w-full min-w-0 flex-col items-center rounded-[12px] py-1 transition-colors hover:bg-elevated/60">
              <RankDot rank={e.rank} className="size-8 text-[13px]" />
              <p className={cn("mt-2 w-full truncate text-[14px] font-semibold", e.nameColour && NAME_COLOUR[e.nameColour], e.isMe && "underline underline-offset-4")}>
                {e.name}
              </p>
              {e.title && <TitleBadge title={e.title} className="mt-1" />}
              <p className="mt-1 text-[13px] text-win tabular">{signedChips(e.profit)}</p>
            </button>
          ) : (
            <p className="text-[13px] text-fg-disabled">—</p>
          )}
          <div className={cn("mt-3 w-full rounded-t-[12px] bg-elevated hairline", heights[i])} />
        </motion.div>
      ))}
    </div>
  );
}

const COLOUR_LABEL = { gold: "Gold", silver: "Silver", bronze: "Bronze" } as const;

function Rules({ kind }: { kind: LeaderboardKind }) {
  const items: Array<[string, React.ReactNode]> =
    kind === "weekly"
      ? [
          ...WEEKLY_TITLES.map((t, i): [string, React.ReactNode] => [`#${i + 1} this week`, <TitleBadge key={t} title={t} />]),
          ["Biggest loss this week", <TitleBadge key="last" title={LAST_PLACE_TITLE} />],
        ]
      : [
          ...ALL_TIME_PERKS.map((p): [string, React.ReactNode] => [
            `#${p.rank} all time`,
            <span key={p.rank} className="text-right">
              <span className={NAME_COLOUR[p.nameColour]}>{COLOUR_LABEL[p.nameColour]} name</span>
              <span className="block text-[12px] text-fg-muted">
                +{p.claimBonusPercent}% daily chips{p.cooldownHours ? `, every ${p.cooldownHours}h` : ""}
              </span>
            </span>,
          ]),
          [`Top ${HALL_OF_FAME_SIZE}`, "Hall of Fame"],
        ];
  return (
    <ul className="divide-y divide-hairline">
      {items.map(([k, v]) => (
        <li key={k} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
          <span className="text-fg-muted">{k}</span>
          {v}
        </li>
      ))}
    </ul>
  );
}

export function LeaderboardView() {
  const { me } = useSession();
  const [kind, setKind] = useState<LeaderboardKind>("weekly");
  const [boards, setBoards] = useState<Partial<Record<LeaderboardKind, LeaderboardDTO>>>({});
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const board = boards[kind];

  useEffect(() => {
    let cancelled = false;
    api<LeaderboardDTO>(`/v1/leaderboard?kind=${kind}`)
      .then((b) => {
        if (cancelled) return;
        setBoards((prev) => ({ ...prev, [kind]: b }));
        setError(null);
      })
      .catch(() => !cancelled && setError("Couldn't load the leaderboard"));
    return () => {
      cancelled = true;
    };
  }, [kind, reload]);

  const rest = board?.entries.slice(3) ?? [];
  const meListed = board?.entries.some((e) => e.isMe);

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6 sm:px-6 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <motion.div {...fadeUp}>
            <h1 className="text-[32px] font-semibold leading-none">Leaderboards</h1>
            <p className="mt-2 text-[13px] text-fg-muted">
              Ranked by profit from play. Claims and bonuses don’t count. Guests don’t rank.
            </p>
          </motion.div>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "weekly", label: "This week" },
              { value: "alltime", label: "All time" },
            ]}
          />
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_300px]">
          <Card padded={false} className="min-w-0 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div key={kind} {...tableSwitch} className="p-4 sm:p-6">
                {!board ? (
                  error ? (
                    <ErrorState title="Couldn’t load the leaderboard" onRetry={() => setReload((n) => n + 1)} />
                  ) : (
                    <ListSkeleton rows={8} />
                  )
                ) : board.entries.length === 0 ? (
                  <EmptyState
                    title={`Nobody is in profit ${kind === "weekly" ? "this week" : "yet"}`}
                    message="Win a few rounds and this spot is yours."
                  />
                ) : (
                  <>
                    <Podium entries={board.entries.slice(0, 3)} onOpen={setOpenId} />
                    {rest.length > 0 && (
                      <ol className="mt-4 divide-y divide-hairline border-t border-hairline">
                        {rest.map((e) => (
                          <li key={e.rank}>
                            <button
                              onClick={() => setOpenId(e.userId)}
                              className={cn(
                                "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[10px] px-2 py-2.5 text-left text-[14px] transition-colors hover:bg-elevated/60",
                                e.isMe && "bg-elevated",
                              )}
                            >
                              <RankDot rank={e.rank} />
                              <PlayerName tag={e} className="flex-1" />
                              <span className="text-[13px] text-win tabular">{signedChips(e.profit)}</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
                {board?.lastPlace && (
                  <button
                    onClick={() => setOpenId(board.lastPlace!.userId)}
                    className="mt-4 flex w-full items-center gap-3 border-t border-hairline pt-3 text-left text-[14px]"
                  >
                    <span className="grid h-7 shrink-0 place-items-center rounded-full px-2 text-[11px] text-fg-muted hairline">Last</span>
                    <PlayerName tag={board.lastPlace} className={cn("flex-1", board.lastPlace.isMe && "underline underline-offset-4")} />
                    <span className="text-[13px] text-loss tabular">{signedChips(board.lastPlace.profit)}</span>
                  </button>
                )}
                {board && me && !meListed && !board.lastPlace?.isMe && (
                  <div className="mt-4 flex items-center justify-between rounded-[12px] bg-elevated px-3 py-2.5 text-[13px] hairline">
                    <span className="text-fg-muted">
                      {me.user.isGuest
                        ? "Create an account to appear here"
                        : board.me?.rank
                          ? `You’re #${board.me.rank}`
                          : "You’re not ranked yet"}
                    </span>
                    <span className="tabular">{signedChips(board.me?.profit ?? 0)}</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </Card>

          <Card className="h-fit">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
              {kind === "weekly" ? "Weekly titles" : "All-time rewards"}
            </p>
            {kind === "weekly" && board?.weekEndsAt && (
              <p className="mt-1 text-[13px]" suppressHydrationWarning>
                Resets in {timeLeft(board.weekEndsAt)}
              </p>
            )}
            <div className="mt-3">
              <Rules kind={kind} />
            </div>
          </Card>
        </div>
      </main>
      <PlayerCardSheet userId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
