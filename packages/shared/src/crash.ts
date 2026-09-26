import { fairFloats } from "./fair";
import type { Chips } from "./money";

/**
 * Crash: one shared live round. The multiplier grows exponentially from 1.00×
 * until it hits the round's crash point; anyone still in loses their stake.
 *
 * Crash point = 0.99 / (1 − r) for one fair float r, floored to hundredths
 * (below 1.00× means an instant crash). P(crash ≥ m) = 0.99 / m, so every
 * cash-out target returns exactly 99%: a 1% house edge whatever you pick.
 */

export const CRASH_LIMITS = {
  minBet: 10,
  maxBet: 10_000,
  /** Auto cash-out range, in hundredths. */
  minAutoX100: 101,
  maxAutoX100: 1_000_000,
} as const;

export const CRASH_MAX_X100 = 1_000_000; // 10,000×

export const CRASH_TIMING = {
  /** Betting window before takeoff. */
  bettingMs: 7_000,
  /** Pause on the crash result before the next round opens. */
  crashedMs: 3_500,
} as const;

/** Growth per millisecond: 2× after ~11.6s, 10× after ~38s, 100× after ~77s. */
export const CRASH_RATE = 0.00006;

/** Crash point of a round, in hundredths (100 = 1.00×). */
export function crashPointX100(serverSeed: string, roundId: string): number {
  const r = fairFloats(serverSeed, roundId, 0, 1)[0]!;
  const x100 = Math.floor(99 / (1 - r));
  return Math.min(CRASH_MAX_X100, Math.max(100, x100));
}

/** Multiplier (hundredths) after `elapsedMs` of flight. */
export function crashMultiplierAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return 100;
  return Math.min(CRASH_MAX_X100, Math.floor(100 * Math.exp(CRASH_RATE * elapsedMs)));
}

/** Milliseconds of flight until the multiplier reaches `x100`. */
export function crashTimeFor(x100: number): number {
  return x100 <= 100 ? 0 : Math.ceil(Math.log(x100 / 100) / CRASH_RATE);
}

export const crashPayout = (stake: Chips, x100: number): Chips => Math.floor((stake * x100) / 100);


// ---------------------------------------------------------------- DTOs

export type CrashPhase = "betting" | "running" | "crashed";

export interface CrashRoundDTO {
  id: string;
  number: number;
  phase: CrashPhase;
  /** sha256(serverSeed), published when betting opens. */
  commit: string;
  opensAt: string;
  /** Takeoff. The multiplier is crashMultiplierAt(now − startsAt) until it crashes. */
  startsAt: string;
  crashedAt: string | null;
  /** Revealed at the crash. */
  crashX100: number | null;
  serverSeed: string | null;
}

export interface CrashBetPublicDTO {
  name: string;
  amount: Chips;
  cashoutX100: number | null;
  payout: Chips | null;
  isMe?: boolean;
}

export interface CrashMyBetDTO {
  roundId: string;
  amount: Chips;
  autoCashoutX100: number | null;
  cashoutX100: number | null;
  payout: Chips | null;
}

export interface CrashStateDTO {
  round: CrashRoundDTO | null;
  /** Latest crash points (hundredths), newest first. */
  recent: number[];
  bets: CrashBetPublicDTO[];
  players: number;
  totalStaked: Chips;
}

export interface CrashSettlementDTO {
  roundId: string;
  crashX100: number;
  staked: Chips;
  cashoutX100: number | null;
  payout: Chips;
  balance: Chips;
}

export type CrashServerMessage =
  | { type: "crash-state"; state: CrashStateDTO; serverNow: string }
  | { type: "crash-bets"; roundId: string; bets: CrashBetPublicDTO[]; players: number; totalStaked: Chips }
  | { type: "crash-settled"; settlement: CrashSettlementDTO }
  /** Your auto cash-out triggered. */
  | { type: "crash-cashout"; myBet: CrashMyBetDTO; balance: Chips }
  | { type: "pong"; serverNow: string }
  | { type: "error"; message: string };
