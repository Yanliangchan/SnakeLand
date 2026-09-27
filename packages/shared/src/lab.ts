import type { Chips } from "./money";

// ---------------------------------------------------------------- The Lab (capture the flag)

export const LAB_CATEGORIES = ["crypto", "web", "forensics", "casino"] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

export const LAB_DIFFICULTIES = ["easy", "medium", "hard", "insane"] as const;
export type LabDifficulty = (typeof LAB_DIFFICULTIES)[number];

/** Default chip reward per difficulty. Each challenge pays once per player. */
export const LAB_REWARDS: Record<LabDifficulty, Chips> = { easy: 1_000, medium: 3_000, hard: 7_500, insane: 15_000 };
export const LAB_MAX_REWARD: Chips = 100_000;

export const LAB_FLAG_MODES = ["static", "per_player"] as const;
export type LabFlagMode = (typeof LAB_FLAG_MODES)[number];

/** Every flag looks like snk{...}. */
export const LAB_FLAG_RE = /^snk\{[A-Za-z0-9_\-!?.@#$%^&*+=:]{1,120}\}$/;

export interface LabChallengeDTO {
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  description: string;
  hint: string | null;
  reward: Chips;
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
  /** Set on a first correct solve. */
  reward: Chips | null;
  balance: Chips | null;
  alreadySolved: boolean;
}

/** Admin view: everything, including drafts. The static flag itself is never sent back. */
export interface AdminLabChallengeDTO {
  id: string;
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  description: string;
  hint: string | null;
  reward: Chips;
  flagMode: LabFlagMode;
  hasStaticFlag: boolean;
  files: { name: string; content: string }[];
  published: boolean;
  sortOrder: number;
  solves: number;
}

export interface AdminLabChallengeInput {
  slug: string;
  title: string;
  category: LabCategory;
  difficulty: LabDifficulty;
  description: string;
  hint: string | null;
  reward: Chips;
  flagMode: LabFlagMode;
  /** Static mode: the flag in plain text. Leave empty on edit to keep the current one. */
  flag?: string;
  files: { name: string; content: string }[];
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
  "{{LCG}}",
  "{{TIMESEED}}",
  "{{ACCESS_LOG}}",
] as const;
