import { rankOf, type Card } from "./cards";
import type { DealtCardDTO, RecentResult, RevealedShoeDTO, ShoeDTO } from "./blackjack";
import type { Chips } from "./money";

export const BACCARAT_RULES = {
  decks: 8,
  /** Cards left in the shoe when it is retired (a round never uses more than 6). */
  reserve: 16,
  minBet: 10,
  /** Maximum total stake across all bets in one round. */
  maxTotal: 10_000,
} as const;

export const BACCARAT_BETS = ["player", "banker", "tie", "playerPair", "bankerPair"] as const;
export type BaccaratBet = (typeof BACCARAT_BETS)[number];
export type BaccaratBets = Partial<Record<BaccaratBet, Chips>>;

export type BaccaratWinner = "player" | "banker" | "tie";

/** Card points: A=1, 2-9 face value, 10/J/Q/K = 0. */
export function baccaratPoints(card: Card): number {
  const r = rankOf(card);
  if (r === "A") return 1;
  if (r === "T" || r === "J" || r === "Q" || r === "K") return 0;
  return Number(r);
}

export function baccaratTotal(cards: readonly Card[]): number {
  return cards.reduce((s, c) => s + baccaratPoints(c), 0) % 10;
}

/**
 * Total returned (stake included) for each bet type:
 * Player 1:1 · Banker 0.95:1 (5% commission, floored) · Tie 8:1 ·
 * Player/Banker returned on a tie · Pairs 11:1.
 */
export function baccaratReturn(
  bet: BaccaratBet,
  stake: Chips,
  outcome: { winner: BaccaratWinner; playerPair: boolean; bankerPair: boolean },
): Chips {
  if (stake <= 0) return 0;
  switch (bet) {
    case "player":
      return outcome.winner === "player" ? stake * 2 : outcome.winner === "tie" ? stake : 0;
    case "banker":
      return outcome.winner === "banker" ? stake + Math.floor((stake * 95) / 100) : outcome.winner === "tie" ? stake : 0;
    case "tie":
      return outcome.winner === "tie" ? stake * 9 : 0;
    case "playerPair":
      return outcome.playerPair ? stake * 12 : 0;
    case "bankerPair":
      return outcome.bankerPair ? stake * 12 : 0;
  }
}

export interface BaccaratRoundDTO {
  id: string;
  tableId: string;
  shoeId: string;
  player: DealtCardDTO[];
  banker: DealtCardDTO[];
  playerTotal: number;
  bankerTotal: number;
  winner: BaccaratWinner;
  natural: boolean;
  playerPair: boolean;
  bankerPair: boolean;
  bets: BaccaratBets;
  /** Amount returned per bet (0 = lost). */
  returns: BaccaratBets;
  totalBet: Chips;
  totalPayout: Chips;
}

export interface BaccaratTableDTO {
  id: string;
  shoe: ShoeDTO;
  /** Winners of recent hands at this table, newest first (the bead road). */
  road: BaccaratWinner[];
  recent: RecentResult[];
  streak: number;
}

export interface BaccaratUpdateDTO {
  round: BaccaratRoundDTO;
  table: BaccaratTableDTO;
  balance: Chips;
  revealedShoe: RevealedShoeDTO | null;
}

export interface BaccaratNextTableDTO {
  table: BaccaratTableDTO;
  revealedShoe: RevealedShoeDTO | null;
}
