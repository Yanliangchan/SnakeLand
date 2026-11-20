import { rankOf, suitOf, type Card } from "./cards";
import type { Chips } from "./money";

/**
 * No-Limit Texas Hold'em, six seats. Empty seats are filled with house bots;
 * a player who sits down takes a bot's seat (the bot leaves after the hand).
 * Each hand's deck is shuffled from a server seed committed (hashed) before
 * the deal and revealed when the hand ends.
 */
export const POKER_SEATS = 6;

export const POKER_TABLES = [
  { id: "low", name: "Low stakes", sb: 10, bb: 20 },
  { id: "mid", name: "Mid stakes", sb: 100, bb: 200 },
  { id: "high", name: "High stakes", sb: 1_000, bb: 2_000 },
] as const;
export type PokerTableId = (typeof POKER_TABLES)[number]["id"];
export const isPokerTableId = (v: unknown): v is PokerTableId => POKER_TABLES.some((t) => t.id === v);
export const pokerTable = (id: PokerTableId) => POKER_TABLES.find((t) => t.id === id)!;

/** Buy-in range, in big blinds. */
export const POKER_BUYIN_BB = { min: 20, max: 100 } as const;
export const pokerBuyIn = (id: PokerTableId) => {
  const { bb } = pokerTable(id);
  return { min: POKER_BUYIN_BB.min * bb, max: POKER_BUYIN_BB.max * bb };
};

export const POKER_TIMING = {
  /** A player's turn; when it runs out they check if they can, else fold. */
  actionMs: 20_000,
  /** Bots "think" for a random time in this range. */
  botMinMs: 900,
  botMaxMs: 2_600,
  /** Pause between streets so the cards land one after another. */
  streetMs: 900,
  /** How long the showdown stays up before the next hand. */
  showdownMs: 5_000,
  /** Two missed turns in a row and the player is stood up (chips go back to the wallet). */
  maxTimeouts: 2,
} as const;

/**
 * House rake, only on pots a real player wins against at least one other real
 * player, and only once the flop is dealt ("no flop, no drop").
 */
export const POKER_RAKE = { percent: 2.5, capBB: 3 } as const;

export const pokerRoom = (id: PokerTableId) => `poker:${id}` as const;

// ---------------------------------------------------------------- Hand ranking

export const HAND_CATEGORIES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

const VALUE: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
export const cardValue = (c: Card) => VALUE[rankOf(c)] ?? Number(rankOf(c));

const RANK_NAME: Record<number, [string, string]> = {
  2: ["Two", "Twos"],
  3: ["Three", "Threes"],
  4: ["Four", "Fours"],
  5: ["Five", "Fives"],
  6: ["Six", "Sixes"],
  7: ["Seven", "Sevens"],
  8: ["Eight", "Eights"],
  9: ["Nine", "Nines"],
  10: ["Ten", "Tens"],
  11: ["Jack", "Jacks"],
  12: ["Queen", "Queens"],
  13: ["King", "Kings"],
  14: ["Ace", "Aces"],
};

export interface HandScore {
  /** Higher is better; equal scores split the pot. */
  score: number;
  category: HandCategory;
  /** The five cards that make the hand. */
  best: Card[];
  /** e.g. "Full house, Kings over Fives". */
  name: string;
}

/** Score exactly five cards. */
function score5(cards: Card[]): HandScore {
  const values = cards.map(cardValue);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Group by count (desc), then value (desc): the order kickers are compared in.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinct = [...counts.keys()].sort((a, b) => b - a);

  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0]! - distinct[4]! === 4) straightHigh = distinct[0]!;
    // The wheel: A-2-3-4-5 is a five-high straight.
    else if (distinct[0] === 14 && distinct[1] === 5) straightHigh = 5;
  }

  let cat: number;
  let kickers: number[];
  if (straightHigh && flush) [cat, kickers] = [8, [straightHigh]];
  else if (groups[0]![1] === 4) [cat, kickers] = [7, [groups[0]![0], groups[1]![0]]];
  else if (groups[0]![1] === 3 && groups[1]![1] === 2) [cat, kickers] = [6, [groups[0]![0], groups[1]![0]]];
  else if (flush) [cat, kickers] = [5, distinct];
  else if (straightHigh) [cat, kickers] = [4, [straightHigh]];
  else if (groups[0]![1] === 3) [cat, kickers] = [3, groups.map((g) => g[0])];
  else if (groups[0]![1] === 2 && groups[1]![1] === 2) [cat, kickers] = [2, groups.map((g) => g[0])];
  else if (groups[0]![1] === 2) [cat, kickers] = [1, groups.map((g) => g[0])];
  else [cat, kickers] = [0, distinct];

  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] ?? 0);

  const n = (v: number, plural = false) => RANK_NAME[v]![plural ? 1 : 0];
  const k = kickers;
  const name =
    cat === 8
      ? k[0] === 14
        ? "Royal flush"
        : `Straight flush, ${n(k[0]!)} high`
      : cat === 7
        ? `Four ${n(k[0]!, true)}`
        : cat === 6
          ? `Full house, ${n(k[0]!, true)} over ${n(k[1]!, true)}`
          : cat === 5
            ? `Flush, ${n(k[0]!)} high`
            : cat === 4
              ? `Straight, ${n(k[0]!)} high`
              : cat === 3
                ? `Three ${n(k[0]!, true)}`
                : cat === 2
                  ? `Two pair, ${n(k[0]!, true)} and ${n(k[1]!, true)}`
                  : cat === 1
                    ? `Pair of ${n(k[0]!, true)}`
                    : `${n(k[0]!)} high`;

  return { score, category: HAND_CATEGORIES[cat]!, best: cards, name };
}

/** Every way to choose five of the given indexes (21 for seven cards). */
function fives(n: number): number[][] {
  const out: number[][] = [];
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === 5) {
      out.push(chosen);
      return;
    }
    for (let i = from; i <= n - (5 - chosen.length); i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return out;
}
const COMBOS = { 5: fives(5), 6: fives(6), 7: fives(7) } as const;

/** The best five-card hand from five to seven cards. */
export function bestHand(cards: readonly Card[]): HandScore {
  const combos = COMBOS[cards.length as 5 | 6 | 7];
  if (!combos) throw new RangeError("need 5 to 7 cards");
  let best: HandScore | null = null;
  for (const idx of combos) {
    const s = score5(idx.map((i) => cards[i]!));
    if (!best || s.score > best.score) best = s;
  }
  return best!;
}

// ---------------------------------------------------------------- DTOs

export type PokerStreet = "preflop" | "flop" | "turn" | "river" | "showdown";
export type PokerActionKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";
export type BotStyle = "loose" | "tight" | "aggressive";

export interface PokerSeatDTO {
  seat: number;
  /** null = empty seat. */
  player: {
    kind: "human" | "bot";
    /** Set for humans only. */
    userId: string | null;
    name: string;
    stack: Chips;
    /** Standing up after this hand. */
    leaving: boolean;
    sittingOut: boolean;
  } | null;
  /** A player waiting to take this seat once the current hand ends. */
  reservedFor: { userId: string; name: string } | null;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  bet: Chips;
  /** Face-up cards (showdown), or the number of face-down cards held. */
  shown: Card[] | null;
  holding: number;
  lastAction: { kind: PokerActionKind; amount: Chips } | null;
  /** Set at showdown. */
  won: Chips | null;
  handName: string | null;
}

export interface PokerPotDTO {
  amount: Chips;
  /** Seats that can win this pot. */
  seats: number[];
}

export interface PokerHandDTO {
  id: string;
  number: number;
  /** sha256(serverSeed), published before the deal. */
  commit: string;
  /** The seed, revealed once the hand is over. */
  seed: string | null;
  button: number;
  board: Card[];
  street: PokerStreet;
  /** Chips in the middle from earlier streets. */
  pot: Chips;
  /** Split into side pots at showdown. */
  pots: PokerPotDTO[];
  toAct: number | null;
  deadline: string | null;
  /** The bet to match on this street, and the smallest legal raise-to. */
  currentBet: Chips;
  minRaiseTo: Chips;
  rake: Chips;
  /** Winners and amounts at showdown. */
  winners: Array<{ seat: number; amount: Chips; handName: string | null }>;
}

export interface PokerTableDTO {
  id: PokerTableId;
  name: string;
  sb: Chips;
  bb: Chips;
  version: number;
  seats: PokerSeatDTO[];
  hand: PokerHandDTO | null;
  /** Humans seated (bots aside). */
  players: number;
}

/** What one player can see of their own seat. */
export interface PokerMeDTO {
  tableId: PokerTableId;
  seat: number | null;
  /** Waiting for a bot's seat to free up. */
  reservedSeat: number | null;
  handId: string | null;
  cards: Card[] | null;
}

export interface PokerLobbyDTO {
  tables: Array<{ id: PokerTableId; name: string; sb: Chips; bb: Chips; players: number; open: number }>;
  /** The table the player is sitting at, if any. */
  seatedAt: PokerTableId | null;
}

/** Live socket messages. */
export type PokerPush =
  | { type: "poker-state"; table: PokerTableDTO }
  | { type: "poker-me"; me: PokerMeDTO }
  | { type: "poker-cashout"; tableId: PokerTableId; amount: Chips; balance: Chips };

// ---------------------------------------------------------------- Legal actions

export interface PokerLegal {
  canFold: boolean;
  canCheck: boolean;
  /** Chips needed to call (0 when checking is possible). Capped at the stack. */
  callAmount: Chips;
  /** Bet/raise "to" range on this street; null when no bet or raise is allowed. */
  raise: { min: Chips; max: Chips } | null;
}

/** What `seat` may do now, from the public table state. The server checks the same rules. */
export function pokerLegal(table: PokerTableDTO, seat: number): PokerLegal | null {
  const hand = table.hand;
  const s = table.seats[seat];
  if (!hand || hand.toAct !== seat || !s?.player || s.folded || s.allIn) return null;
  const stack = s.player.stack;
  const toCall = Math.max(0, hand.currentBet - s.bet);
  const maxTo = s.bet + stack;
  const canRaise = maxTo > hand.currentBet;
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, stack),
    raise: canRaise ? { min: Math.min(hand.minRaiseTo, maxTo), max: maxTo } : null,
  };
}
