import {
  BLACKJACK_RULES,
  handValue,
  type BlackjackRoundDTO,
  type DealtCardDTO,
  type RevealedShoeDTO,
  type ShoeDTO,
} from "@snakeland/shared";
import type { blackjackShoes } from "../../db/schema";
import { allowedActions, totalPayout, totalStaked, type EngineCard, type EngineState } from "./engine";

type ShoeRow = typeof blackjackShoes.$inferSelect;

export function toShoeDTO(shoe: ShoeRow): ShoeDTO {
  const totalCards = shoe.decks * 52;
  return {
    id: shoe.id,
    commit: shoe.serverSeedHash,
    clientSeed: shoe.clientSeed,
    cardsRemaining: totalCards - shoe.position,
    totalCards,
  };
}

/** Only call once `revealedAt` is set. */
export function toRevealedShoeDTO(shoe: ShoeRow): RevealedShoeDTO {
  if (!shoe.revealedAt) throw new Error("shoe is not revealed");
  return {
    id: shoe.id,
    commit: shoe.serverSeedHash,
    serverSeed: shoe.serverSeed,
    clientSeed: shoe.clientSeed,
    decks: shoe.decks,
  };
}

const visible = (c: EngineCard): DealtCardDTO => ({ code: c.code, seq: c.seq });

/**
 * Client view of a round. The dealer's hole card is withheld until revealed:
 * this is the only place engine state is turned into a response.
 */
export function toRoundDTO(
  row: { id: string; tableId: string; shoeId: string; version: number },
  state: EngineState,
): BlackjackRoundDTO {
  const dealerCards: DealtCardDTO[] = state.dealer.map((c, i) =>
    i === 1 && !state.holeRevealed ? { code: null, seq: c.seq } : visible(c),
  );
  const shownDealer = dealerCards.flatMap((c) => (c.code ? [c.code] : []));
  const dv = handValue(shownDealer);
  const settled = state.phase === "settled";

  return {
    id: row.id,
    tableId: row.tableId,
    shoeId: row.shoeId,
    version: row.version,
    phase: state.phase,
    activeHand: state.active,
    hands: state.hands.map((h) => {
      const v = handValue(h.cards.map((c) => c.code));
      return {
        cards: h.cards.map(visible),
        bet: h.bet,
        doubled: h.doubled,
        total: v.total,
        soft: v.soft,
        status: h.status,
        result: h.result,
        payout: h.payout,
      };
    }),
    dealer: { cards: dealerCards, total: dv.total, soft: dv.soft, revealed: state.holeRevealed },
    insurance: { ...state.insurance },
    allowed: allowedActions(state),
    totalBet: totalStaked(state),
    totalPayout: settled ? totalPayout(state) : null,
  };
}

export const CUT_POSITION = Math.floor(BLACKJACK_RULES.decks * 52 * BLACKJACK_RULES.penetration);
