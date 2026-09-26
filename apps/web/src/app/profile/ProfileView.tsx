"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { GAMES, STREAK_PERKS, isGameId, type ProfileDTO } from "@snakeland/shared";
import { AppHeader } from "@/components/AppHeader";
import { PlayerName } from "@/components/PlayerName";
import { Avatar, ButtonLink, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { chips, dateShort, signedChips } from "@/lib/format";
import { expoOut, fadeUp } from "@/lib/motion";
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

const MILESTONES = [
  { days: STREAK_PERKS.claimBonus.days, label: `+${STREAK_PERKS.claimBonus.percent}% daily chips` },
  { days: STREAK_PERKS.goldName.days, label: "Gold name" },
  { days: STREAK_PERKS.fastClaim.days, label: `${STREAK_PERKS.fastClaim.cooldownHours}h daily cooldown` },
];

function Streak({ days }: { days: number }) {
  const max = MILESTONES.at(-1)!.days;
  const pct = Math.min(1, days / max) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-fg-muted">Days in the weekly top 5</p>
        <p className="text-[20px] font-semibold tabular">{days}</p>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-elevated">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: expoOut }}
          className="h-full rounded-full bg-gold"
        />
        {MILESTONES.map((m) => (
          <span
            key={m.days}
            className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface", days >= m.days ? "bg-gold" : "bg-elevated")}
            style={{ left: `${(m.days / max) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {MILESTONES.map((m) => (
          <li key={m.days} className="flex items-center justify-between text-[13px]">
            <span className={days >= m.days ? "text-fg" : "text-fg-muted"}>
              {m.days} days · {m.label}
            </span>
            <span className={cn("text-[12px]", days >= m.days ? "text-gold" : "text-fg-disabled")}>
              {days >= m.days ? "Unlocked" : `${m.days - days} to go`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProfileView() {
  const { me } = useSession();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balance = me?.wallet.balance;

  useEffect(() => {
    let cancelled = false;
    api<ProfileDTO>("/v1/profile")
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setError("Couldn't load your profile"));
    return () => {
      cancelled = true;
    };
  }, [balance]);

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

        {error && !p && <p className="mt-6 text-center text-[13px] text-loss">{error}</p>}

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
            </Card>

            <Card className="h-fit">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Perks</p>
              <div className="mt-3 rounded-[12px] bg-bg/50 p-4 hairline">
                <p className="text-[13px] text-fg-muted">Next daily claim</p>
                <p className="mt-1 text-[22px] font-semibold tabular">+{chips(p.perks.nextClaim.amount)}</p>
                <p className="mt-0.5 text-[12px] text-fg-muted">
                  {p.perks.nextClaim.reasons.length ? <span className="text-gold">{p.perks.nextClaim.reasons.join(" · ")}</span> : "Standard claim"}
                  {` · every ${p.perks.nextClaim.cooldownHours}h`}
                </p>
              </div>
              <div className="mt-4">
                <Streak days={p.perks.top5Streak} />
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
