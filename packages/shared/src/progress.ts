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

/** UTC calendar day, e.g. "2026-09-26". */
export const utcDay = (date: Date = new Date()) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------- all-time → titles

export const ALL_TIME_TITLES = ["Snake King", "Viper", "Cobra"] as const;
export type AllTimeTitle = (typeof ALL_TIME_TITLES)[number];
export const HALL_OF_FAME_SIZE = 10;

export function titleForAllTimeRank(rank: number | null): AllTimeTitle | null {
  return rank !== null && rank >= 1 && rank <= 3 ? ALL_TIME_TITLES[rank - 1]! : null;
}

// ---------------------------------------------------------------- weekly → perks

/** Daily-claim multiplier for this week's top 3 (in tenths: 30 = ×3). */
export const WEEKLY_CLAIM_MULTIPLIER_X10: Record<number, number> = { 1: 30, 2: 20, 3: 15 };

/** Rewards for consecutive days spent in the weekly top 5. */
export const STREAK_PERKS = {
  claimBonus: { days: 3, percent: 10 },
  goldName: { days: 7 },
  fastClaim: { days: 14, cooldownHours: 12 },
} as const;

export const DAILY_COOLDOWN_HOURS = 24;

export interface ClaimTerms {
  amount: Chips;
  cooldownHours: number;
  /** Human-readable reasons, e.g. ["Weekly #1 ×3", "3-day top-5 streak +10%"]. */
  reasons: string[];
}

/** What a player's next daily claim pays, given their weekly rank and top-5 streak. */
export function claimTerms(weeklyRank: number | null, top5Streak: number): ClaimTerms {
  const reasons: string[] = [];
  let x10 = 10;
  if (weeklyRank !== null && WEEKLY_CLAIM_MULTIPLIER_X10[weeklyRank]) {
    x10 = WEEKLY_CLAIM_MULTIPLIER_X10[weeklyRank]!;
    reasons.push(`Weekly #${weeklyRank} ×${x10 / 10}`);
  }
  let amount = Math.floor((DAILY_CLAIM_AMOUNT * x10) / 10);
  if (top5Streak >= STREAK_PERKS.claimBonus.days) {
    amount = Math.floor((amount * (100 + STREAK_PERKS.claimBonus.percent)) / 100);
    reasons.push(`${top5Streak}-day top-5 streak +${STREAK_PERKS.claimBonus.percent}%`);
  }
  const fast = top5Streak >= STREAK_PERKS.fastClaim.days;
  if (fast) reasons.push(`${STREAK_PERKS.fastClaim.days}-day streak: ${STREAK_PERKS.fastClaim.cooldownHours}h cooldown`);
  return { amount, cooldownHours: fast ? STREAK_PERKS.fastClaim.cooldownHours : DAILY_COOLDOWN_HOURS, reasons };
}

// ---------------------------------------------------------------- DTOs

export type LeaderboardKind = "weekly" | "alltime";

export interface PlayerTag {
  name: string;
  title: AllTimeTitle | null;
  hallOfFame: boolean;
  goldName: boolean;
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
    top5Streak: number;
    nextClaim: ClaimTerms;
    nextDailyClaimAt: string | null;
  };
}
