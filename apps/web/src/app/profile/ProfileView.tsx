"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ALL_TIME_PERKS, GAMES, isGameId, type ProfileDTO } from "@snakeland/shared";
import { GameDonut } from "@/components/GameDonut";
import { InviteCard } from "@/components/InviteCard";
import { AppHeader } from "@/components/AppHeader";
import { ErrorState } from "@/components/ErrorState";
import { NAME_COLOUR, PlayerName, TitleBadge } from "@/components/PlayerName";
import { Avatar, ButtonLink, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips, dateShort, signedChips } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import { useSession } from "@/providers/session";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "win" | "loss" }) {
  return (
    <div className="rounded-[12px] bg-bg/50 p-3.5 hairline sm:p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">{label}</p>
      <p className={cn("mt-1.5 truncate text-[20px] font-semibold tracking-[-0.02em] tabular", tone === "win" && "text-win", tone === "loss" && "text-loss")}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[12px] text-fg-muted">{sub}</p>}
    </div>
  );
}

const COLOUR_LABEL = { gold: "Gold", silver: "Silver", bronze: "Bronze" } as const;

/** The all-time top 3 rewards, with the player's own row highlighted. */
function Rewards({ allTimeRank, title }: { allTimeRank: number | null; title: string | null }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-fg-muted">Weekly title</span>
        {title ? <TitleBadge title={title} /> : <span className="text-fg-disabled">None this week</span>}
      </div>
      <p className="mt-4 text-[13px] text-fg-muted">All-time rewards</p>
      <ul className="mt-2 space-y-1.5">
        {ALL_TIME_PERKS.map((p) => {
          const mine = allTimeRank === p.rank;
          return (
            <li
              key={p.rank}
              className={cn("flex items-center justify-between rounded-[10px] px-3 py-2 text-[13px] hairline", mine ? "bg-elevated" : "bg-bg/50")}
            >
              <span>
                <span className="text-fg-muted">#{p.rank} · </span>
                <span className={NAME_COLOUR[p.nameColour]}>{COLOUR_LABEL[p.nameColour]} name</span>
              </span>
              <span className={cn("text-[12px]", mine ? "text-fg" : "text-fg-muted")}>
                +{p.claimBonusPercent}%{p.cooldownHours ? ` · every ${p.cooldownHours}h` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProfileView() {
  const { me } = useSession();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const balance = me?.wallet.balance;

  useEffect(() => {
    let cancelled = false;
    api<ProfileDTO>("/v1/profile")
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setError("Couldn't load your profile"));
    return () => {
      cancelled = true;
    };
  }, [balance, reload]);

  if (!me) return null;
  const p = profile;
  const fav = p?.stats.favouriteGame;

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-3 pb-16 pt-6 sm:px-6 sm:pt-10">
        <Card className="flex flex-wrap items-center gap-4">
          <Avatar name={me.user.name} className="size-14 text-[18px]" />
          <div className="min-w-0 flex-1 basis-[12rem]">
            <h1 className="text-[24px] font-semibold leading-tight">
              {p ? <PlayerName tag={p.user} /> : me.user.name}
            </h1>
            <p className="mt-1 truncate text-[13px] text-fg-muted">
              {me.user.isGuest ? "Guest on this device" : me.user.email}
              {p && ` · Joined ${dateShort(p.user.joinedAt)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <ButtonLink href="/leaderboard" variant="secondary" size="sm">
              Leaderboards
            </ButtonLink>
            <ButtonLink href="/settings" variant="ghost" size="sm">
              Settings
            </ButtonLink>
          </div>
        </Card>

        {me.user.isGuest && (
          <motion.div {...fadeUp} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface px-5 py-4 text-[13px] hairline">
            <span className="text-fg-muted">Guests don’t appear on leaderboards or earn perks. Your chips and stats carry over when you sign up.</span>
            <ButtonLink href="/sign-up" size="sm">
              Create account
            </ButtonLink>
          </motion.div>
        )}

        {!me.user.isGuest && <InviteCard />}

        {error && !p && <ErrorState title="Couldn’t load your profile" onRetry={() => setReload((n) => n + 1)} />}

        {p && (
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_340px]">
            <Card>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Stats</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                <Stat label="Balance" value={chips(p.balance)} sub="chips" />
                <Stat
                  label="This week"
                  value={signedChips(p.stats.weeklyProfit)}
                  sub={p.stats.weeklyRank ? `#${p.stats.weeklyRank} this week` : "Unranked"}
                  tone={p.stats.weeklyProfit > 0 ? "win" : p.stats.weeklyProfit < 0 ? "loss" : undefined}
                />
                <Stat
                  label="All time"
                  value={signedChips(p.stats.allTimeProfit)}
                  sub={p.stats.allTimeRank ? `#${p.stats.allTimeRank} all time` : "Unranked"}
                  tone={p.stats.allTimeProfit > 0 ? "win" : p.stats.allTimeProfit < 0 ? "loss" : undefined}
                />
                <Stat label="Wagered" value={chips(p.stats.totalWagered)} sub="chips in total" />
                <Stat label="Biggest win" value={chips(p.stats.biggestWin)} sub="single payout" />
                <Stat
                  label="Rounds"
                  value={chips(p.stats.roundsPlayed)}
                  sub={fav ? `Mostly ${isGameId(fav) ? GAMES[fav].name : fav}` : "played"}
                />
              </div>
              {p.stats.gameBreakdown.length > 0 && (
                <div className="mt-5 border-t border-hairline pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Games played</p>
                  <div className="mt-3">
                    <GameDonut breakdown={p.stats.gameBreakdown} />
                  </div>
                </div>
              )}
            </Card>

            <Card className="h-fit">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Rewards</p>
              <div className="mt-3 rounded-[12px] bg-bg/50 p-4 hairline">
                <p className="text-[13px] text-fg-muted">Next daily claim</p>
                <p className="mt-1 text-[22px] font-semibold tabular">+{chips(p.perks.nextClaim.amount)}</p>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  {p.perks.nextClaim.reasons.length ? <span className="text-gold">{p.perks.nextClaim.reasons.join(" · ")}</span> : "Standard claim"}
                  {` · every ${p.perks.nextClaim.cooldownHours}h`}
                </p>
              </div>
              <div className="mt-4">
                <Rewards allTimeRank={p.stats.allTimeRank} title={p.user.title} />
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
