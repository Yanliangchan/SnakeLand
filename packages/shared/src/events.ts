import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Chips } from "./money";
import type { GameId } from "./games";
import { isServerSeed } from "./fair";

/**
 * Admin-run events. Everyone who joins gets the same event stack (separate
 * from their wallet) and the best final stacks share the pot.
 *
 * - "race": everyone plays the same N rounds of one game, with identical
 *   outcomes (the same mine layouts, card orders or crash points).
 * - "ffa": free-for-all. Play any instant game with the event stack until
 *   the window closes.
 */
export const EVENT_MODES = ["race", "ffa"] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export const RACE_GAMES = ["mines", "hilo", "crash"] as const;
export type RaceGame = (typeof RACE_GAMES)[number];
export const isRaceGame = (v: unknown): v is RaceGame => typeof v === "string" && (RACE_GAMES as readonly string[]).includes(v);

/** Games playable with an event stack in a free-for-all. The shared live tables stay out. */
export const FFA_GAMES = ["mines", "plinko", "carrier", "tower", "crossing", "penalty", "hilo", "blackjack", "baccarat"] as const satisfies readonly GameId[];
export type FfaGame = (typeof FFA_GAMES)[number];
export const isFfaGame = (v: unknown): v is FfaGame => typeof v === "string" && (FFA_GAMES as readonly string[]).includes(v);

export const EVENT_STATUSES = ["scheduled", "live", "ended", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Pot split for 1st/2nd/3rd, in percent. Fewer finishers → shares are rescaled. */
export const EVENT_PRIZE_SPLIT = [50, 30, 20] as const;

export const EVENT_LIMITS = {
  stack: { min: 100, max: 1_000_000 },
  buyIn: { max: 1_000_000 },
  topUp: { max: 100_000_000 },
  rounds: { min: 1, max: 50 },
  minutes: { min: 1, max: 7 * 24 * 60 },
} as const;

/** Race rounds use a fixed client seed so every player's outcome is identical. */
export const RACE_CLIENT_SEED = "race";

/** Crash race: the player picks a cash-out target before each round. */
export const RACE_CRASH_TARGET = { min: 101, max: 100_000 } as const; // 1.01× – 1,000×

/** Server seed for race round `index` (0-based), derived from the event's committed seed. */
export function raceRoundSeed(eventSeed: string, index: number): string {
  if (!isServerSeed(eventSeed)) throw new TypeError("invalid event seed");
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("invalid round");
  return bytesToHex(hmac(sha256, hexToBytes(eventSeed), utf8ToBytes(`round:${index}`)));
}

/**
 * Split `pot` between ranked scores (highest first). Ties share the places
 * they cover. Any rounding remainder goes to the first place.
 */
export function eventPrizes(scores: readonly number[], pot: Chips): Chips[] {
  const n = scores.length;
  if (n === 0 || pot <= 0) return scores.map(() => 0);
  const split = EVENT_PRIZE_SPLIT.slice(0, Math.min(n, EVENT_PRIZE_SPLIT.length));
  const total = split.reduce((a, b) => a + b, 0);
  const place = (i: number) => (i < split.length ? split[i]! / total : 0);
  const out = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[j + 1] === scores[i]) j++;
    let share = 0;
    for (let k = i; k <= j; k++) share += place(k);
    const each = Math.floor((pot * share) / (j - i + 1));
    for (let k = i; k <= j; k++) out[k] = each;
    i = j + 1;
  }
  const paid = out.reduce((a, b) => a + b, 0);
  out[0]! += pot - paid;
  return out;
}

// ---------------------------------------------------------------- DTOs

export interface MinesRaceConfig {
  size: number;
  mines: number;
}

export interface EventSummaryDTO {
  id: string;
  title: string;
  mode: EventMode;
  /** Race: the game everyone plays. Free-for-all: null. */
  game: RaceGame | null;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  stack: Chips;
  buyIn: Chips;
  pot: Chips;
  rounds: number | null;
  mines: MinesRaceConfig | null;
  entrants: number;
}

export interface EventStandingDTO {
  rank: number;
  userId: string;
  name: string;
  stack: Chips;
  roundsPlayed: number;
  wagered: Chips;
  qualified: boolean;
  payout: Chips | null;
}

export interface EventEntryDTO {
  stack: Chips;
  roundsPlayed: number;
  wagered: Chips;
  qualified: boolean;
  /** Race: rounds still to play. */
  roundsLeft: number | null;
  payout: Chips | null;
  rank: number | null;
}

export interface EventDetailDTO extends EventSummaryDTO {
  /** sha256 of the race seed, shown from the start. */
  commit: string | null;
  /** The race seed, revealed once the event is over. */
  seed: string | null;
  standings: EventStandingDTO[];
  me: EventEntryDTO | null;
  canJoin: boolean;
  serverNow: string;
}

export interface EventListDTO {
  events: EventSummaryDTO[];
}

export interface CrashRaceResultDTO {
  round: number;
  crashX100: number;
  targetX100: number;
  won: boolean;
  payout: Chips;
  entry: EventEntryDTO;
}

export interface AdminEventInput {
  title: string;
  mode: EventMode;
  game: RaceGame | null;
  startsAt: string;
  minutes: number;
  stack: Chips;
  buyIn: Chips;
  topUp: Chips;
  rounds: number | null;
  mines: MinesRaceConfig | null;
}
