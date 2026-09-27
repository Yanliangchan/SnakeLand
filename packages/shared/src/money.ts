/**
 * All balances and amounts are integer chips. Never use floats for money:
 * multipliers are applied server-side and floored to an integer before they
 * touch the wallet.
 */
export type Chips = number;

/** Chips granted when a wallet is first created (registered or guest). */
export const STARTING_BALANCE: Chips = 1_000;

/** Chips granted by the daily free claim. */
export const DAILY_CLAIM_AMOUNT: Chips = 1_000;

/** Rolling cooldown between daily claims. */
export const DAILY_CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Hard ceiling so a balance can never approach Number.MAX_SAFE_INTEGER. */
export const MAX_BALANCE: Chips = 1_000_000_000_000;

export const TRANSACTION_TYPES = [
  "signup_bonus",
  "daily_claim",
  "bet",
  "payout",
  "refund",
  "guest_merge",
  "admin_adjust",
  "lab_reward",
  "bonus_spin",
  "referral",
  "tip",
  "rain",
  "lab_track",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export function isChipAmount(value: unknown): value is Chips {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Apply a payout multiplier to a stake, flooring to whole chips. */
export function applyMultiplier(stake: Chips, multiplier: number): Chips {
  if (!isChipAmount(stake) || stake < 0) throw new RangeError("stake must be a non-negative integer");
  if (!Number.isFinite(multiplier) || multiplier < 0) throw new RangeError("invalid multiplier");
  // Work in hundredths to avoid binary float drift (e.g. 1.15 * 100).
  const hundredths = Math.round(multiplier * 100);
  return Math.floor((stake * hundredths) / 100);
}
