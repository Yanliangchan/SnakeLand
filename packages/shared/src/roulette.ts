import { fairFloats } from "./fair";
import type { Chips } from "./money";

/** European single-zero wheel, clockwise from zero. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
] as const;

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColor = "red" | "black" | "zero";
export const pocketColor = (n: number): PocketColor => (n === 0 ? "zero" : RED_NUMBERS.has(n) ? "red" : "black");

export const ROULETTE_LIMITS = { minBet: 10, maxRoundTotal: 5_000 } as const;

/** Live cycle: bets open, then the wheel spins to a result that stays up briefly. */
export const ROULETTE_TIMING = { bettingMs: 15_000, spinMs: 7_000, resultMs: 3_000 } as const;

export const ROULETTE_WHEELS = [
  { id: "w1", name: "Wheel 1", offsetMs: 0 },
  { id: "w2", name: "Wheel 2", offsetMs: 8_000 },
  { id: "w3", name: "Wheel 3", offsetMs: 16_000 },
] as const;
export type WheelId = (typeof ROULETTE_WHEELS)[number]["id"];
export const isWheelId = (v: unknown): v is WheelId => ROULETTE_WHEELS.some((w) => w.id === v);

export type RouletteBetKind =
  | "straight"
  | "split"
  | "street"
  | "corner"
  | "trio"
  | "first-four"
  | "line"
  | "dozen"
  | "column"
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high";

export interface RouletteBetDef {
  id: string;
  kind: RouletteBetKind;
  numbers: readonly number[];
}

// Table layout: number n sits in column c = (n-1)/3 (0..11), row r = (n-1)%3 (0 = bottom: 1,4,7…).
const add = (map: Map<string, RouletteBetDef>, kind: RouletteBetKind, numbers: number[], id?: string) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const key = id ?? `${kind}:${sorted.join("-")}`;
  map.set(key, { id: key, kind, numbers: sorted });
};

function buildCatalogue(): Map<string, RouletteBetDef> {
  const m = new Map<string, RouletteBetDef>();
  for (let n = 0; n <= 36; n++) add(m, "straight", [n]);
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) add(m, "split", [n, n + 1]); // vertical neighbour in the same column
    if (n <= 33) add(m, "split", [n, n + 3]); // horizontal neighbour
  }
  for (const n of [1, 2, 3]) add(m, "split", [0, n]);
  for (let c = 0; c < 12; c++) {
    const b = c * 3 + 1;
    add(m, "street", [b, b + 1, b + 2]);
    if (c < 11) {
      add(m, "line", [b, b + 1, b + 2, b + 3, b + 4, b + 5]);
      add(m, "corner", [b, b + 1, b + 3, b + 4]);
      add(m, "corner", [b + 1, b + 2, b + 4, b + 5]);
    }
  }
  add(m, "trio", [0, 1, 2]);
  add(m, "trio", [0, 2, 3]);
  add(m, "first-four", [0, 1, 2, 3]);
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  for (const d of [1, 2, 3]) add(m, "dozen", range(d * 12 - 11, d * 12), `dozen:${d}`);
  for (const c of [1, 2, 3]) add(m, "column", range(1, 36).filter((n) => (n - c) % 3 === 0), `column:${c}`);
  add(m, "red", [...RED_NUMBERS], "red");
  add(m, "black", range(1, 36).filter((n) => !RED_NUMBERS.has(n)), "black");
  add(m, "odd", range(1, 36).filter((n) => n % 2 === 1), "odd");
  add(m, "even", range(1, 36).filter((n) => n % 2 === 0), "even");
  add(m, "low", range(1, 18), "low");
  add(m, "high", range(19, 36), "high");
  return m;
}

/** Every legal bet on the table, by id (e.g. "straight:17", "corner:17-18-20-21", "red"). */
export const ROULETTE_BETS: ReadonlyMap<string, RouletteBetDef> = buildCatalogue();

/** Total returned (stake included): stake × 36 / n. 35:1 straight … 1:1 even money. */
export function rouletteReturn(betId: string, stake: Chips, result: number): Chips {
  const def = ROULETTE_BETS.get(betId);
  if (!def) throw new RangeError("unknown bet");
  return def.numbers.includes(result) ? (stake * 36) / def.numbers.length : 0;
}

/** The winning pocket for a round: one fair float, keyed by the round id. */
export function rouletteResult(serverSeed: string, roundId: string): number {
  return Math.floor(fairFloats(serverSeed, roundId, 0, 1)[0]! * 37);
}

// ---------------------------------------------------------------- DTOs

export type RoulettePhase = "betting" | "spinning" | "result";

export interface RouletteRoundDTO {
  id: string;
  number: number;
  phase: RoulettePhase;
  /** sha256(serverSeed), published when betting opens. */
  commit: string;
  opensAt: string;
  closesAt: string;
  spinEndsAt: string | null;
  /** Sent when betting closes, so the wheel can animate to it. */
  result: number | null;
  /** Revealed with the result. */
  serverSeed: string | null;
}

export interface RouletteWheelDTO {
  wheelId: WheelId;
  round: RouletteRoundDTO | null;
  /** Latest results, newest first. */
  recent: number[];
  players: number;
  totalStaked: Chips;
}

export interface RouletteMyBetsDTO {
  roundId: string;
  bets: Array<{ betId: string; amount: Chips }>;
  total: Chips;
}

export interface RouletteSettlementDTO {
  wheelId: WheelId;
  roundId: string;
  result: number;
  staked: Chips;
  payout: Chips;
  balance: Chips;
  winningBets: string[];
}

export type RouletteServerMessage =
  | { type: "state"; wheel: RouletteWheelDTO; serverNow: string }
  | { type: "activity"; wheelId: WheelId; roundId: string; players: number; totalStaked: Chips }
  | { type: "settled"; settlement: RouletteSettlementDTO }
  | { type: "pong"; serverNow: string }
  | { type: "error"; message: string };

export type RouletteClientMessage = { type: "join"; wheelId: WheelId } | { type: "ping" };
