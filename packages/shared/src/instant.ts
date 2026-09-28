import { fairFloats, fairShuffle } from "./fair";
import type { Chips } from "./money";

/**
 * Mines and Plinko: single-player "instant" games.
 *
 * Multipliers are integers in hundredths ("x100": 150 = 1.50x) so payouts are
 * exact: payout = floor(stake * x100 / 100). Both games carry a 1% house edge.
 */

export const HOUSE_EDGE_PERCENT = 1;
export const INSTANT_BET_LIMITS = { min: 10, max: 100_000 } as const;

export function applyX100(stake: Chips, x100: number): Chips {
  if (!Number.isSafeInteger(stake) || stake < 0) throw new RangeError("stake must be a non-negative integer");
  if (!Number.isSafeInteger(x100) || x100 < 0) throw new RangeError("x100 must be a non-negative integer");
  return Number((BigInt(stake) * BigInt(x100)) / 100n);
}

export function formatX100(x100: number): string {
  return `${(x100 / 100).toFixed(2)}×`;
}

// ---------------------------------------------------------------- Mines

/** Board side lengths players can choose (3×3 … 8×8). */
export const MINES_SIZES = [3, 4, 5, 6, 7, 8] as const;
export const MINES_DEFAULT_SIZE = 5;
/** Mines carries a 3% house edge (97% return); Plinko keeps its own tables. */
export const MINES_EDGE_PERCENT = 3;
/** Multipliers are capped at 1,000,000× so payouts stay exact integers (and within the balance limit). */
export const MINES_MAX_MULTIPLIER_X100 = 100_000_000;

export const isMinesSize = (v: unknown): v is number => (MINES_SIZES as readonly unknown[]).includes(v);
export const minesTiles = (size: number) => size * size;

function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}

/** Valid mine counts for a board: at least 1, at most one fewer than the tiles. */
export function minesRange(tiles: number): { min: number; max: number } {
  return { min: 1, max: tiles - 1 };
}

/**
 * Multiplier after `picks` safe tiles on a board of `tiles` with `mines`, in
 * hundredths: floor(97 * C(tiles, picks) / C(tiles - mines, picks)), i.e. the
 * fair odds minus the house edge.
 */
export function minesMultiplierX100(tiles: number, mines: number, picks: number): number {
  if (!Number.isInteger(tiles) || !isMinesSize(Math.sqrt(tiles))) throw new RangeError("invalid board");
  const { min, max } = minesRange(tiles);
  if (!Number.isInteger(mines) || mines < min || mines > max) throw new RangeError("invalid mine count");
  if (!Number.isInteger(picks) || picks < 0 || picks > tiles - mines) throw new RangeError("invalid pick count");
  if (picks === 0) return 100;
  const x = (BigInt(100 - MINES_EDGE_PERCENT) * choose(tiles, picks)) / choose(tiles - mines, picks);
  return x > BigInt(MINES_MAX_MULTIPLIER_X100) ? MINES_MAX_MULTIPLIER_X100 : Number(x);
}

/** Tile indexes (row-major) holding mines, sorted. */
export function minesPositions(serverSeed: string, clientSeed: string, tiles: number, mines: number): number[] {
  const all = Array.from({ length: tiles }, (_, i) => i);
  const shuffled = fairShuffle(all, fairFloats(serverSeed, clientSeed, 0, tiles - 1));
  return shuffled.slice(0, mines).sort((a, b) => a - b);
}

// ---------------------------------------------------------------- Plinko

export const PLINKO_ROWS_MIN = 8;
export const PLINKO_ROWS_MAX = 16;
export const PLINKO_RISKS = ["low", "medium", "high"] as const;
export type PlinkoRisk = (typeof PLINKO_RISKS)[number];

/** Bucket multipliers (x100), left to right. Each table returns 98.7–99.0% (see tests). */
export const PLINKO_TABLES: Record<PlinkoRisk, Record<number, readonly number[]>> = {
  low: {
    8: [600, 310, 140, 70, 50, 70, 140, 310, 600],
    9: [680, 400, 200, 90, 50, 50, 90, 200, 400, 680],
    10: [820, 450, 240, 120, 60, 60, 60, 120, 240, 450, 820],
    11: [830, 540, 310, 170, 80, 50, 50, 80, 170, 310, 540, 830],
    12: [1000, 630, 380, 200, 110, 60, 50, 60, 110, 200, 380, 630, 1000],
    13: [1200, 730, 460, 270, 130, 80, 50, 50, 80, 130, 270, 460, 730, 1200],
    14: [1200, 880, 560, 330, 180, 90, 60, 50, 60, 90, 180, 330, 560, 880, 1200],
    15: [1600, 1000, 640, 390, 230, 120, 60, 60, 60, 60, 120, 230, 390, 640, 1000, 1600],
    16: [1900, 1200, 760, 490, 280, 160, 80, 60, 50, 60, 80, 160, 280, 490, 760, 1200, 1900],
  },
  medium: {
    8: [1400, 460, 140, 40, 40, 40, 140, 460, 1400],
    9: [1800, 650, 210, 60, 40, 40, 60, 210, 650, 1800],
    10: [2400, 910, 330, 90, 40, 40, 40, 90, 330, 910, 2400],
    11: [3100, 1200, 460, 150, 50, 40, 40, 50, 150, 460, 1200, 3100],
    12: [4100, 1700, 670, 210, 60, 50, 40, 50, 60, 210, 670, 1700, 4100],
    13: [5400, 2300, 950, 340, 110, 40, 40, 40, 40, 110, 340, 950, 2300, 5400],
    14: [6800, 3200, 1300, 500, 150, 60, 40, 40, 40, 60, 150, 500, 1300, 3200, 6800],
    15: [9100, 4300, 1800, 720, 230, 70, 50, 40, 40, 50, 70, 230, 720, 1800, 4300, 9100],
    16: [11000, 6000, 2500, 1000, 350, 120, 50, 40, 40, 40, 50, 120, 350, 1000, 2500, 6000, 11000],
  },
  high: {
    8: [3100, 650, 90, 20, 20, 20, 90, 650, 3100],
    9: [4700, 1100, 180, 20, 20, 20, 20, 180, 1100, 4700],
    10: [7000, 1700, 310, 50, 20, 20, 20, 50, 310, 1700, 7000],
    11: [11000, 2800, 550, 80, 20, 20, 20, 20, 80, 550, 2800, 11000],
    12: [17000, 4600, 940, 150, 20, 20, 20, 20, 20, 150, 940, 4600, 17000],
    13: [26000, 7200, 1500, 260, 30, 30, 20, 20, 30, 30, 260, 1500, 7200, 26000],
    14: [42000, 11000, 2600, 450, 60, 30, 20, 20, 20, 30, 60, 450, 2600, 11000, 42000],
    15: [64000, 18000, 4500, 790, 100, 30, 20, 20, 20, 20, 30, 100, 790, 4500, 18000, 64000],
    16: [101000, 29000, 7300, 1300, 190, 30, 30, 20, 20, 20, 30, 30, 190, 1300, 7300, 29000, 101000],
  },
};

export function isPlinkoRows(rows: unknown): rows is number {
  return typeof rows === "number" && Number.isInteger(rows) && rows >= PLINKO_ROWS_MIN && rows <= PLINKO_ROWS_MAX;
}

/**
 * The ball's path: one fair float per peg row, below 0.5 goes left (0), else
 * right (1). The landing bucket is the number of rights, so the bucket is fixed
 * by the seeds before anything is animated, and the animation follows this path.
 */
export function plinkoPath(serverSeed: string, clientSeed: string, rows: number): { path: (0 | 1)[]; bucket: number } {
  if (!isPlinkoRows(rows)) throw new RangeError("invalid row count");
  const path = fairFloats(serverSeed, clientSeed, 0, rows).map((f) => (f < 0.5 ? 0 : 1) as 0 | 1);
  return { path, bucket: path.reduce<number>((s, b) => s + b, 0) };
}

export function plinkoMultiplierX100(rows: number, risk: PlinkoRisk, bucket: number): number {
  const table = PLINKO_TABLES[risk][rows];
  const x = table?.[bucket];
  if (x === undefined) throw new RangeError("invalid plinko bucket");
  return x;
}

// ---------------------------------------------------------------- DTOs

export interface FairRevealDTO {
  commit: string;
  serverSeed: string;
  clientSeed: string;
}

export type MinesStatus = "playing" | "cashed_out" | "bust";

export interface MinesRoundDTO {
  id: string;
  version: number;
  status: MinesStatus;
  bet: Chips;
  /** Board side length (tiles = size²). */
  size: number;
  mines: number;
  /** Safe tiles picked so far, in pick order. */
  picks: number[];
  /** Current multiplier (x100) for the safe tiles picked so far. */
  multiplierX100: number;
  /** Multiplier (x100) if the next pick is safe, or null when no safe tiles remain. */
  nextMultiplierX100: number | null;
  payout: Chips | null;
  commit: string;
  /** Only once the round is over. */
  minePositions: number[] | null;
  /** The tile that ended the round on a bust. */
  bustTile: number | null;
  reveal: FairRevealDTO | null;
}

export interface MinesUpdateDTO {
  round: MinesRoundDTO;
  balance: Chips | null;
  /** Commit for the seed your next round will use. */
  nextCommit: string;
}

export interface MinesStateDTO {
  round: MinesRoundDTO | null;
  nextCommit: string;
}

export interface PlinkoDropDTO {
  id: string;
  bet: Chips;
  rows: number;
  risk: PlinkoRisk;
  path: (0 | 1)[];
  bucket: number;
  multiplierX100: number;
  payout: Chips;
  reveal: FairRevealDTO;
}

export interface PlinkoDropResultDTO {
  drop: PlinkoDropDTO;
  balance: Chips;
  nextCommit: string;
}
