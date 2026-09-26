/**
 * Cards are two-character codes: rank (A 2-9 T J Q K) + suit (S H D C),
 * e.g. "AS", "TD", "9H".
 */
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"] as const;
export const SUITS = ["S", "H", "D", "C"] as const;
export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

const CARD_RE = /^[A2-9TJQK][SHDC]$/;

export function isCard(value: unknown): value is Card {
  return typeof value === "string" && CARD_RE.test(value);
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** Unshuffled shoe: `decks` copies of a standard 52-card deck in a fixed order. */
export function orderedShoe(decks: number): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}`);
  }
  return out;
}

/** Blackjack point value; aces count 1 here and are promoted to 11 by handValue. */
export function blackjackValue(card: Card): number {
  const r = rankOf(card);
  if (r === "A") return 1;
  if (r === "T" || r === "J" || r === "Q" || r === "K") return 10;
  return Number(r);
}

export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += blackjackValue(c);
    if (rankOf(c) === "A") aces++;
  }
  // At most one ace can count as 11 without busting.
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}
