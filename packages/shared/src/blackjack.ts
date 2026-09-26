import type { Card } from "./cards";
import type { Chips } from "./money";

export const BLACKJACK_RULES = {
  decks: 6,
  /** Reshuffle once this share of the shoe has been dealt (checked between rounds). */
  penetration: 0.75,
  minBet: 10,
  maxBet: 5_000,
  maxHands: 4,
  /** Blackjack pays 3:2 (floored to whole chips). */
  blackjackPayout: { num: 3, den: 2 },
  dealerHitsSoft17: false,
  doubleAfterSplit: true,
  insurance: true,
  resplitAces: false,
} as const;

export const BLACKJACK_ACTIONS = ["hit", "stand", "double", "split", "insurance", "no_insurance"] as const;
export type BlackjackAction = (typeof BLACKJACK_ACTIONS)[number];

/** A dealt card. `code` is null while face-down; `seq` is the draw order within the round. */
export interface DealtCardDTO {
  code: Card | null;
  seq: number;
}

export type HandStatus = "playing" | "stood" | "bust" | "blackjack";
export type HandResult = "win" | "lose" | "push" | "blackjack";

export interface BlackjackHandDTO {
  cards: DealtCardDTO[];
  bet: Chips;
  doubled: boolean;
  total: number;
  soft: boolean;
  status: HandStatus;
  result: HandResult | null;
  payout: Chips | null;
}

export type BlackjackPhase = "insurance" | "player" | "settled";

export interface BlackjackRoundDTO {
  id: string;
  tableId: string;
  shoeId: string;
  /** Monotonic state version; actions must echo it to prevent double-submits. */
  version: number;
  phase: BlackjackPhase;
  hands: BlackjackHandDTO[];
  activeHand: number;
  dealer: { cards: DealtCardDTO[]; total: number; soft: boolean; revealed: boolean };
  insurance: { offered: boolean; taken: boolean | null; stake: Chips; payout: Chips | null };
  allowed: BlackjackAction[];
  totalBet: Chips;
  totalPayout: Chips | null;
}

export type RecentResult = "win" | "lose" | "push";

export interface ShoeDTO {
  id: string;
  /** sha256(serverSeed), shown before any card of this shoe is dealt. */
  commit: string;
  clientSeed: string | null;
  cardsRemaining: number;
  totalCards: number;
}

export interface RevealedShoeDTO {
  id: string;
  commit: string;
  serverSeed: string;
  clientSeed: string | null;
  decks: number;
}

export interface BlackjackTableDTO {
  id: string;
  shoe: ShoeDTO;
  round: BlackjackRoundDTO | null;
  recent: RecentResult[];
  streak: number;
}

/** Response to any round-changing request. */
export interface BlackjackUpdateDTO {
  round: BlackjackRoundDTO;
  shoe: ShoeDTO;
  recent: RecentResult[];
  streak: number;
  /** Authoritative balance after this request, or null if it didn't change. */
  balance: Chips | null;
  /** Set when this round finished a shoe: its seed is now public. */
  revealedShoe: RevealedShoeDTO | null;
}

export interface NextTableDTO {
  table: BlackjackTableDTO;
  /** The previous table's shoe, now public. Null if there was no previous table. */
  revealedShoe: RevealedShoeDTO | null;
}
