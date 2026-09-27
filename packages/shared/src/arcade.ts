import { RANKS, SUITS, type Card } from "./cards";
import { fairFloats, fairShuffle } from "./fair";
import type { Chips } from "./money";
import type { FairRevealDTO } from "./instant";

/**
 * Arcade games: Carrier (a plane collects boosts and must land on a carrier),
 * Tower (pick a safe door on each floor) and Crossing (hop across traffic).
 * All return 97% (a 3% edge) and use the per-round seed commit–reveal shared
 * with Mines and Plinko. Multipliers are in hundredths.
 */

export const ARCADE_RTP_PERCENT = 97;

// ---------------------------------------------------------------- Carrier

export const CARRIER_MODES = ["calm", "normal", "fast", "turbo"] as const;
export type CarrierMode = (typeof CARRIER_MODES)[number];
export const isCarrierMode = (v: unknown): v is CarrierMode => CARRIER_MODES.includes(v as CarrierMode);

/** Boosts collected per flight: longer flights swing harder but land less often. */
export const CARRIER_STEPS: Record<CarrierMode, number> = { calm: 4, normal: 6, fast: 8, turbo: 10 };
export const CARRIER_MAX_X100 = 100_000; // 1,000×

export type CarrierEventKind = "cloud" | "add" | "mul" | "rocket";

/** What can appear on a flight, with its chance in percent. Adds are in hundredths. */
export const CARRIER_EVENTS: ReadonlyArray<{ kind: CarrierEventKind; value: number; weight: number }> = [
  { kind: "cloud", value: 0, weight: 30 },
  { kind: "add", value: 50, weight: 20 },
  { kind: "add", value: 100, weight: 12 },
  { kind: "add", value: 200, weight: 6 },
  { kind: "mul", value: 2, weight: 7 },
  { kind: "rocket", value: 0, weight: 25 },
];

function applyEvent(x100: number, e: { kind: CarrierEventKind; value: number }): number {
  const next =
    e.kind === "add" ? x100 + e.value : e.kind === "mul" ? x100 * e.value : e.kind === "rocket" ? Math.floor(x100 / 2) : x100;
  return Math.min(CARRIER_MAX_X100, next);
}

function pickEvent(f: number) {
  let acc = 0;
  for (const e of CARRIER_EVENTS) {
    acc += e.weight / 100;
    if (f < acc) return e;
  }
  return CARRIER_EVENTS[CARRIER_EVENTS.length - 1]!;
}

/** Expected multiplier after n boosts, ignoring rounding and the cap (both only lower it). */
export function carrierExpectedMultiplier(steps: number): number {
  let ea = 0;
  let eb = 0;
  for (const e of CARRIER_EVENTS) {
    const p = e.weight / 100;
    ea += p * (e.kind === "mul" ? e.value : e.kind === "rocket" ? 0.5 : 1);
    eb += p * (e.kind === "add" ? e.value / 100 : 0);
  }
  let m = 1;
  for (let i = 0; i < steps; i++) m = ea * m + eb;
  return m;
}

/** Chance of landing on the carrier, chosen so the flight returns 97% on average. */
export function carrierLandChance(mode: CarrierMode): number {
  return ARCADE_RTP_PERCENT / 100 / carrierExpectedMultiplier(CARRIER_STEPS[mode]);
}

export interface CarrierEventDTO {
  kind: CarrierEventKind;
  value: number;
  /** Multiplier after this boost. */
  x100: number;
}

export interface CarrierOutcome {
  events: CarrierEventDTO[];
  /** Multiplier on arrival, whether or not it lands. */
  finalX100: number;
  landed: boolean;
  /** What pays: finalX100 if landed, else 0. */
  multiplierX100: number;
}

/** The whole flight from the seeds: one float per boost, then one for the landing. */
export function carrierFlight(serverSeed: string, clientSeed: string, mode: CarrierMode): CarrierOutcome {
  const steps = CARRIER_STEPS[mode];
  const floats = fairFloats(serverSeed, clientSeed, 0, steps + 1);
  let x100 = 100;
  const events: CarrierEventDTO[] = [];
  for (let i = 0; i < steps; i++) {
    const e = pickEvent(floats[i]!);
    x100 = applyEvent(x100, e);
    events.push({ kind: e.kind, value: e.value, x100 });
  }
  const landed = floats[steps]! < carrierLandChance(mode);
  return { events, finalX100: x100, landed, multiplierX100: landed ? x100 : 0 };
}

/** Exact expected return for a mode (with rounding and the cap), by walking every outcome. */
export function carrierExactRtp(mode: CarrierMode): number {
  let dist = new Map<number, number>([[100, 1]]);
  for (let i = 0; i < CARRIER_STEPS[mode]; i++) {
    const next = new Map<number, number>();
    for (const [x, p] of dist) {
      for (const e of CARRIER_EVENTS) {
        const y = applyEvent(x, e);
        next.set(y, (next.get(y) ?? 0) + (p * e.weight) / 100);
      }
    }
    dist = next;
  }
  let ev = 0;
  for (const [x, p] of dist) ev += (x / 100) * p;
  return ev * carrierLandChance(mode);
}

export interface CarrierFlightDTO extends CarrierOutcome {
  id: string;
  bet: Chips;
  mode: CarrierMode;
  payout: Chips;
  reveal: FairRevealDTO;
}

export interface CarrierFlightResultDTO {
  flight: CarrierFlightDTO;
  balance: Chips;
  nextCommit: string;
}

// ---------------------------------------------------------------- Ladder games (Tower, Crossing)

export type LadderGame = "tower" | "crossing" | "penalty" | "hilo";
export const LADDER_GAMES: readonly LadderGame[] = ["tower", "crossing", "penalty", "hilo"];

export const TOWER_MODES = ["easy", "medium", "hard", "expert"] as const;
export type TowerMode = (typeof TOWER_MODES)[number];
/** Doors per floor and how many of them are safe. */
export const TOWER_CONFIG: Record<TowerMode, { doors: number; safe: number }> = {
  easy: { doors: 4, safe: 3 },
  medium: { doors: 3, safe: 2 },
  hard: { doors: 2, safe: 1 },
  expert: { doors: 3, safe: 1 },
};
export const TOWER_FLOORS = 8;

export const CROSSING_MODES = ["easy", "medium", "hard", "daredevil"] as const;
export type CrossingMode = (typeof CROSSING_MODES)[number];
/** Survival odds per lane as a fraction, and how many lanes the road has. */
export const CROSSING_CONFIG: Record<CrossingMode, { survive: [number, number]; lanes: number }> = {
  easy: { survive: [24, 25], lanes: 24 },
  medium: { survive: [11, 12], lanes: 22 },
  hard: { survive: [4, 5], lanes: 18 },
  daredevil: { survive: [3, 5], lanes: 12 },
};

export const PENALTY_MODES = ["easy", "medium", "hard"] as const;
export type PenaltyMode = (typeof PENALTY_MODES)[number];
/** Spots in the goal, and how many of them the keeper covers on each kick. */
export const PENALTY_CONFIG: Record<PenaltyMode, { spots: number; covered: number }> = {
  easy: { spots: 5, covered: 1 },
  medium: { spots: 3, covered: 1 },
  hard: { spots: 2, covered: 1 },
};
export const PENALTY_KICKS = 10;

export const HILO_MODES = ["classic"] as const;
export type HiloMode = (typeof HILO_MODES)[number];
/** Cards you can play through in one round (skips included). */
export const HILO_MAX_STEPS = 52;
export const HILO_MAX_X100 = 1_000_000; // 10,000×
export type HiloChoice = "higher" | "lower" | "skip";
export const HILO_CHOICES: readonly HiloChoice[] = ["higher", "lower", "skip"];

export type LadderMode = TowerMode | CrossingMode | PenaltyMode | HiloMode;

export function isLadderMode(game: LadderGame, mode: unknown): mode is LadderMode {
  const list: readonly string[] =
    game === "tower" ? TOWER_MODES : game === "crossing" ? CROSSING_MODES : game === "penalty" ? PENALTY_MODES : HILO_MODES;
  return typeof mode === "string" && list.includes(mode);
}

/** Steps to the top: floors, lanes, kicks, or cards. */
export function ladderLength(game: LadderGame, mode: LadderMode): number {
  if (game === "tower") return TOWER_FLOORS;
  if (game === "crossing") return CROSSING_CONFIG[mode as CrossingMode].lanes;
  if (game === "penalty") return PENALTY_KICKS;
  return HILO_MAX_STEPS;
}

/** Survival odds of one step as [numerator, denominator]. */
function stepOdds(game: LadderGame, mode: LadderMode): [bigint, bigint] {
  if (game === "tower") {
    const c = TOWER_CONFIG[mode as TowerMode];
    return [BigInt(c.safe), BigInt(c.doors)];
  }
  if (game === "penalty") {
    const c = PENALTY_CONFIG[mode as PenaltyMode];
    return [BigInt(c.spots - c.covered), BigInt(c.spots)];
  }
  if (game === "hilo") throw new RangeError("Hi-Lo odds depend on the cards; use hiloMultiplierX100");
  const [n, d] = CROSSING_CONFIG[mode as CrossingMode].survive;
  return [BigInt(n), BigInt(d)];
}

/** Multiplier after `steps` safe steps: floor(97 ÷ P(surviving them all)), in hundredths. */
export function ladderMultiplierX100(game: LadderGame, mode: LadderMode, steps: number): number {
  if (steps <= 0) return 100;
  const [n, d] = stepOdds(game, mode);
  const k = BigInt(steps);
  return Number((BigInt(ARCADE_RTP_PERCENT) * d ** k) / n ** k);
}

/** Tower: the safe doors on every floor, from the seeds. */
export function towerLayout(serverSeed: string, clientSeed: string, mode: TowerMode): number[][] {
  const { doors, safe } = TOWER_CONFIG[mode];
  const per = doors - 1;
  const floats = fairFloats(serverSeed, clientSeed, 0, TOWER_FLOORS * per);
  const ids = Array.from({ length: doors }, (_, i) => i);
  return Array.from({ length: TOWER_FLOORS }, (_, f) =>
    fairShuffle(ids, floats.slice(f * per, f * per + per))
      .slice(0, safe)
      .sort((a, b) => a - b),
  );
}

/** Crossing: the lane where a car hits (0-based), or null if the road is clear all the way. */
export function crossingHitLane(serverSeed: string, clientSeed: string, mode: CrossingMode): number | null {
  const { survive, lanes } = CROSSING_CONFIG[mode];
  const q = 1 - survive[0] / survive[1];
  const floats = fairFloats(serverSeed, clientSeed, 0, lanes);
  const i = floats.findIndex((f) => f < q);
  return i === -1 ? null : i;
}

/** Penalty: the spots the keeper covers on every kick, from the seeds. */
export function penaltyKeeper(serverSeed: string, clientSeed: string, mode: PenaltyMode): number[][] {
  const { spots, covered } = PENALTY_CONFIG[mode];
  const per = spots - 1;
  const floats = fairFloats(serverSeed, clientSeed, 0, PENALTY_KICKS * per);
  const ids = Array.from({ length: spots }, (_, i) => i);
  return Array.from({ length: PENALTY_KICKS }, (_, k) =>
    fairShuffle(ids, floats.slice(k * per, k * per + per))
      .slice(0, covered)
      .sort((a, b) => a - b),
  );
}

// ---------------------------------------------------------------- Hi-Lo

/** Cards are 0–51: rank = card % 13 + 1 (A = 1 … K = 13), suit = floor(card / 13). */
export const hiloRank = (card: number) => (card % 13) + 1;

/** The standard card code for a Hi-Lo card number, for display. */
export const hiloCardCode = (card: number): Card => `${RANKS[card % 13]!}${SUITS[Math.floor(card / 13)]!}`;

/** The deck for a round: every card drawn independently (an endless shoe). */
export function hiloCards(serverSeed: string, clientSeed: string): number[] {
  return fairFloats(serverSeed, clientSeed, 0, HILO_MAX_STEPS + 1).map((f) => Math.floor(f * 52));
}

/** Ranks out of 13 that win a guess from `card`: "higher or same" or "lower or same". */
export function hiloWinningRanks(card: number, choice: "higher" | "lower"): number {
  const r = hiloRank(card);
  return choice === "higher" ? 14 - r : r;
}

export function hiloWins(from: number, next: number, choice: "higher" | "lower"): boolean {
  return choice === "higher" ? hiloRank(next) >= hiloRank(from) : hiloRank(next) <= hiloRank(from);
}

/**
 * Multiplier after a run of guesses: floor(97 × Π 13 / k), where k is the
 * number of winning ranks for each guess. Skips don't change it.
 */
export function hiloMultiplierX100(cards: number[], picks: HiloChoice[]): number {
  let num = BigInt(ARCADE_RTP_PERCENT);
  let den = 1n;
  picks.forEach((p, i) => {
    if (p === "skip") return;
    num *= 13n;
    den *= BigInt(hiloWinningRanks(cards[i]!, p));
  });
  const x = Number(num / den);
  return Math.min(HILO_MAX_X100, x);
}

/** What each guess from `card` would pay next, given the multiplier so far; null when it can't raise it. */
export function hiloNextX100(cards: number[], picks: HiloChoice[], card: number): { higher: number | null; lower: number | null } {
  const now = hiloMultiplierX100(cards, picks);
  const after = (c: "higher" | "lower") => {
    const x = hiloMultiplierX100([...cards.slice(0, picks.length), card], [...picks, c]);
    return x > now ? x : null;
  };
  return { higher: after("higher"), lower: after("lower") };
}

export type LadderStatus = "playing" | "cashed_out" | "bust";

export interface LadderRoundDTO {
  id: string;
  game: LadderGame;
  mode: LadderMode;
  version: number;
  status: LadderStatus;
  bet: Chips;
  /** Safe steps taken so far. */
  level: number;
  /** Tower/Penalty: the door or spot picked each step. Hi-Lo: 0 higher, 1 lower, 2 skip. Crossing: empty. */
  picks: number[];
  multiplierX100: number;
  nextMultiplierX100: number | null;
  payout: Chips | null;
  commit: string;
  /** Revealed when the round ends. */
  towerLayout: number[][] | null;
  crossingHitLane: number | null;
  /** Penalty: where the keeper covered on each kick taken so far (all kicks once over). */
  penaltyKeeper: number[][] | null;
  /** Hi-Lo: the cards seen so far, current card last (plus the losing card once over). */
  hiloCards: number[] | null;
  /** Hi-Lo: what "higher or same" / "lower or same" would pay on the current card. */
  hiloNext: { higher: number | null; lower: number | null } | null;
  reveal: FairRevealDTO | null;
}

export interface LadderUpdateDTO {
  round: LadderRoundDTO;
  balance: Chips | null;
  nextCommit: string;
}

export interface LadderStateDTO {
  round: LadderRoundDTO | null;
  nextCommit: string;
}
