import { DAILY_CLAIM_AMOUNT, type Chips } from "./money";

/**
 * Leaderboards, titles and perks.
 *
 * Profit = net chips from play (bets, payouts, refunds); claims, bonuses and
 * admin adjustments don't count. Only registered, non-suspended players rank.
 */

// Weeks start Monday 00:00 UTC. 1970-01-05 was a Monday.
const EPOCH_MONDAY_MS = 4 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

export function weekKey(date: Date = new Date()): number {
  return Math.floor((date.getTime() - EPOCH_MONDAY_MS) / WEEK_MS);
}

export function weekStart(key: number): Date {
  return new Date(EPOCH_MONDAY_MS + key * WEEK_MS);
}

// ---------------------------------------------------------------- weekly → titles

/** This week's top 3 carry a title; the week's biggest loser gets the last one. */
export const WEEKLY_TITLES = ["Snake King", "Black Mamba", "Viper"] as const;
export const LAST_PLACE_TITLE = "Safety Stores";
export type WeeklyTitle = (typeof WEEKLY_TITLES)[number] | typeof LAST_PLACE_TITLE;

export function titleForWeeklyRank(rank: number | null): WeeklyTitle | null {
  return rank !== null && rank >= 1 && rank <= WEEKLY_TITLES.length ? WEEKLY_TITLES[rank - 1]! : null;
}

// ---------------------------------------------------------------- all-time → name colours + perks

export type NameColour = "gold" | "silver" | "bronze";

export interface AllTimePerk {
  rank: number;
  nameColour: NameColour;
  /** Extra daily chips, in percent. */
  claimBonusPercent: number;
  /** Daily claim cooldown, when shorter than the standard 24h. */
  cooldownHours?: number;
}

export const ALL_TIME_PERKS: readonly AllTimePerk[] = [
  { rank: 1, nameColour: "gold", claimBonusPercent: 20, cooldownHours: 12 },
  { rank: 2, nameColour: "silver", claimBonusPercent: 10 },
  { rank: 3, nameColour: "bronze", claimBonusPercent: 5 },
];
export const HALL_OF_FAME_SIZE = 10;
export const DAILY_COOLDOWN_HOURS = 24;

export const allTimePerk = (rank: number | null) =>
  rank === null ? null : (ALL_TIME_PERKS.find((p) => p.rank === rank) ?? null);

export interface ClaimTerms {
  amount: Chips;
  cooldownHours: number;
  /** Human-readable reasons, e.g. ["All-time #1: +20%, every 12h"]. */
  reasons: string[];
}

/** What a player's next daily claim pays, given their all-time rank. */
export function claimTerms(allTimeRank: number | null): ClaimTerms {
  const perk = allTimePerk(allTimeRank);
  if (!perk) return { amount: DAILY_CLAIM_AMOUNT, cooldownHours: DAILY_COOLDOWN_HOURS, reasons: [] };
  const cooldownHours = perk.cooldownHours ?? DAILY_COOLDOWN_HOURS;
  const every = perk.cooldownHours ? `, every ${perk.cooldownHours}h` : "";
  return {
    amount: Math.floor((DAILY_CLAIM_AMOUNT * (100 + perk.claimBonusPercent)) / 100),
    cooldownHours,
    reasons: [`All-time #${perk.rank}: +${perk.claimBonusPercent}%${every}`],
  };
}

// ---------------------------------------------------------------- DTOs

export type LeaderboardKind = "weekly" | "alltime";

export interface PlayerTag {
  name: string;
  /** From this week's board. */
  title: WeeklyTitle | null;
  /** From the all-time board. */
  nameColour: NameColour | null;
  hallOfFame: boolean;
}

export interface LeaderboardEntryDTO extends PlayerTag {
  rank: number;
  profit: Chips;
  isMe: boolean;
}

export interface LeaderboardDTO {
  kind: LeaderboardKind;
  /** For weekly boards: when this week started / ends. */
  weekStartsAt: string | null;
  weekEndsAt: string | null;
  entries: LeaderboardEntryDTO[];
  /** Weekly only: the registered player with the biggest loss this week ("Safety Stores"). */
  lastPlace: (PlayerTag & { profit: Chips; isMe: boolean }) | null;
  me: { rank: number | null; profit: Chips } | null;
}

export interface ProfileDTO {
  user: PlayerTag & { id: string; email: string | null; isGuest: boolean; joinedAt: string };
  balance: Chips;
  stats: {
    weeklyProfit: Chips;
    weeklyRank: number | null;
    allTimeProfit: Chips;
    allTimeRank: number | null;
    totalWagered: Chips;
    biggestWin: Chips;
    roundsPlayed: number;
    favouriteGame: string | null;
  };
  perks: {
    nextClaim: ClaimTerms;
    nextDailyClaimAt: string | null;
  };
}
