import type { Chips } from "./money";

// ---------------------------------------------------------------- The Lab (capture the flag)

export const LAB_CATEGORIES = ["crypto", "web", "forensics", "casino", "misc"] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

export const LAB_DIFFICULTIES = ["easy", "medium", "hard", "insane"] as const;
export type LabDifficulty = (typeof LAB_DIFFICULTIES)[number];

/** Default chip reward per difficulty. Each challenge pays once per player. */
export const LAB_REWARDS: Record<LabDifficulty, Chips> = { easy: 1_000, medium: 3_000, hard: 7_500, insane: 15_000 };
export const LAB_MAX_REWARD: Chips = 100_000;

export const LAB_FLAG_MODES = ["static", "per_player"] as const;
export type LabFlagMode = (typeof LAB_FLAG_MODES)[number];

/** A tiered hint. Opening one reduces this challenge's reward by `penalty` percent. */
export interface LabHint {
  text: string;
  /** Percent of the reward given up for opening this hint (0–100). */
  penalty: number;
}
/** A challenge never gives up more than this share of its reward to hints. */
export const LAB_MAX_HINT_PENALTY = 75;

/** Reward left after `penalty` percent is taken off, never below 1 chip. */
export function labRewardAfterHints(reward: Chips, penalty: number): Chips {
  const capped = Math.min(LAB_MAX_HINT_PENALTY, Math.max(0, penalty));
  return Math.max(1, Math.floor((reward * (100 - capped)) / 100));
}

/** Every flag looks like snk{...}. */
export const LAB_FLAG_RE = /^snk\{[A-Za-z0-9_\-!?.@#$%^&*+=:]{1,120}\}$/;

/** One hint as a player sees it: locked (text hidden, penalty shown) or open. */
export interface LabHintView {
  penalty: number;
  /** Null until the player opens it (or the challenge is solved). */
  text: string | null;
}

export interface LabChallengeDTO {
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  /** Optional campaign/track this challenge belongs to. */
  track: string | null;
  description: string;
  hints: LabHintView[];
  /** Full reward if solved with no more hints opened. */
  reward: Chips;
  /** Reward at stake right now, after the hints already opened. */
  effectiveReward: Chips;
  files: { name: string }[];
  solves: number;
  solved: boolean;
}

export interface LabListDTO {
  challenges: LabChallengeDTO[];
  /** Chips earned from the Lab so far. */
  earned: Chips;
  /** Guests can look around but must sign up to download and submit. */
  canPlay: boolean;
}

export interface LabSubmitResultDTO {
  correct: boolean;
  /** Set on a first correct solve (after any hint penalty). */
  reward: Chips | null;
  balance: Chips | null;
  alreadySolved: boolean;
  /** Set when this solve completes a whole track, paying a one-time bonus. */
  trackBonus: { track: string; amount: Chips } | null;
}

/** Completing every published challenge in a track pays this share of the track's total reward. */
export const LAB_TRACK_BONUS_PCT = 25;

/** Opening a hint returns its text and the reward now at stake. */
export interface LabHintResultDTO {
  text: string;
  effectiveReward: Chips;
}

/** Admin view: everything, including drafts. The static flag itself is never sent back. */
export interface AdminLabChallengeDTO {
  id: string;
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  track: string | null;
  description: string;
  reward: Chips;
  flagMode: LabFlagMode;
  hasStaticFlag: boolean;
  files: { name: string; content: string }[];
  hints: LabHint[];
  published: boolean;
  sortOrder: number;
  solves: number;
}

export interface AdminLabChallengeInput {
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  track: string | null;
  description: string;
  reward: Chips;
  flagMode: LabFlagMode;
  /** Static mode: the flag in plain text. Leave empty on edit to keep the current one. */
  flag?: string;
  files: { name: string; content: string }[];
  hints: LabHint[];
  published: boolean;
  sortOrder: number;
}

/**
 * Placeholders a per-player challenge's files and description may use.
 * Each is filled with that player's own flag, transformed.
 */
export const LAB_PLACEHOLDERS = [
  "{{FLAG}}",
  "{{FLAG_B64}}",
  "{{FLAG_HEX}}",
  "{{FLAG_ROT13}}",
  "{{FLAG_REVERSED}}",
  "{{FLAG_CAESAR}}",
  "{{FLAG_XOR}}",
  "{{FLAG_ATBASH}}",
  "{{FLAG_VIGENERE}}",
  "{{FLAG_MORSE}}",
  "{{FLAG_BINARY}}",
  "{{FLAG_URLENC}}",
  "{{REPEAT_XOR}}",
  "{{RSA}}",
  "{{GIT_LOG}}",
  "{{LCG}}",
  "{{TIMESEED}}",
  "{{ACCESS_LOG}}",
  "{{ONION}}",
] as const;
