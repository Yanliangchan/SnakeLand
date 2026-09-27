import type { Chips } from "./money";

// ---------------------------------------------------------------- Daily bonus spin

/** The wheel's base chip amounts (before the streak multiplier). Index is the segment. */
export const SPIN_BASE: readonly number[] = [200, 400, 800, 300, 1500, 500, 3000, 600];
/** Slightly under a day, so a once-a-day habit never just misses the window. */
export const SPIN_COOLDOWN_HOURS = 22;
export const SPIN_STREAK_CAP = 7;

/** Reward multiplier for a daily streak: 1× on day 1, +20% per extra day, capped. */
export function spinMultiplier(streak: number): number {
  return 1 + Math.min(SPIN_STREAK_CAP - 1, Math.max(0, streak - 1)) * 0.2;
}

/** The wheel amounts a player would see at a given streak. */
export function spinSegments(streak: number): number[] {
  const m = spinMultiplier(Math.max(1, streak));
  return SPIN_BASE.map((b) => Math.max(1, Math.floor(b * m)));
}

export interface SpinStateDTO {
  canSpin: boolean;
  /** When the next spin unlocks (ISO), or null if ready now. */
  nextSpinAt: string | null;
  /** Current streak; the next spin would be at streak (or 1 if it lapsed). */
  streak: number;
  /** The wheel as it stands for the next spin. */
  segments: number[];
}

export interface SpinResultDTO {
  index: number;
  amount: Chips;
  balance: Chips;
  streak: number;
  nextSpinAt: string;
  segments: number[];
}

// ---------------------------------------------------------------- Referrals

/** Reward the referrer and the new player each get on a successful referral. */
export const REFERRAL_REWARD: Chips = 2_000;
/** A new account can only be referred within this window of signing up. */
export const REFERRAL_WINDOW_HOURS = 24;
/** Referral codes are the referrer's user id; validated as an opaque token. */
export const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ReferralStateDTO {
  code: string;
  /** How many players this account has referred. */
  referred: number;
  earned: Chips;
  reward: Chips;
}

// ---------------------------------------------------------------- Tips & rain (chat)

export const TIP_MIN: Chips = 10;
export const TIP_MAX: Chips = 1_000_000;

// ---------------------------------------------------------------- Announcements

export const ANNOUNCEMENT_LEVELS = ["info", "success", "warn"] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

export interface AnnouncementDTO {
  id: string;
  body: string;
  level: AnnouncementLevel;
  href: string | null;
}

export interface AdminAnnouncementDTO extends AnnouncementDTO {
  active: boolean;
  createdAt: string;
}
