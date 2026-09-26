import {
  BLACKJACK_RULES as RULES,
  blackjackValue,
  handValue,
  rankOf,
  type BlackjackAction,
  type BlackjackPhase,
  type Card,
  type HandResult,
  type HandStatus,
} from "@snakeland/shared";
import { GameError } from "../errors";

/**
 * Pure blackjack rules. No I/O and no randomness: cards come from `draw`,
 * so every path is reproducible from the shoe order. Money is expressed as
 * the stake an action requires (`debit`) and the final payout per hand; the
 * service turns those into wallet transactions.
 */

export interface EngineCard {
  code: Card;
  seq: number;
}

export interface EngineHand {
  cards: EngineCard[];
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  status: HandStatus;
  result: HandResult | null;
  payout: number | null;
}

export interface EngineState {
  phase: BlackjackPhase;
  hands: EngineHand[];
  active: number;
  dealer: EngineCard[];
  holeRevealed: boolean;
  insurance: { offered: boolean; taken: boolean | null; stake: number; payout: number | null };
  nextSeq: number;
}

export type Draw = () => Card;

export interface ActResult {
  state: EngineState;
  /** Extra stake this action requires (double / split / insurance). */
  debit: number;
}

const codes = (cards: EngineCard[]) => cards.map((c) => c.code);
const isTen = (card: Card) => blackjackValue(card) === 10;

function take(state: EngineState, draw: Draw): EngineCard {
  return { code: draw(), seq: state.nextSeq++ };
}

function newHand(bet: number, cards: EngineCard[], fromSplit = false): EngineHand {
  return { cards, bet, doubled: false, fromSplit, splitAces: false, status: "playing", result: null, payout: null };
}

function clone(state: EngineState): EngineState {
  return structuredClone(state);
}

export function deal(bet: number, draw: Draw): EngineState {
  const state: EngineState = {
    phase: "player",
    hands: [],
    active: 0,
    dealer: [],
    holeRevealed: false,
    insurance: { offered: false, taken: null, stake: 0, payout: null },
    nextSeq: 0,
  };
  const p1 = take(state, draw);
  const up = take(state, draw);
  const p2 = take(state, draw);
  const hole = take(state, draw);
  state.hands.push(newHand(bet, [p1, p2]));
  state.dealer.push(up, hole);

  if (handValue([p1.code, p2.code]).total === 21) state.hands[0]!.status = "blackjack";

  if (RULES.insurance && rankOf(up.code) === "A") {
    state.phase = "insurance";
    state.insurance = { offered: true, taken: null, stake: Math.floor(bet / 2), payout: null };
    return state;
  }
  return afterPeek(state);
}

/** Dealer checks for blackjack (upcard A or 10), then play continues or the round ends. */
function afterPeek(state: EngineState): EngineState {
  const up = state.dealer[0]!.code;
  const dealerBJ = (rankOf(up) === "A" || isTen(up)) && handValue(codes(state.dealer)).total === 21;

  if (state.insurance.offered) {
    state.insurance.payout = state.insurance.taken && dealerBJ ? state.insurance.stake * 3 : 0;
  }

  if (dealerBJ) {
    state.holeRevealed = true;
    for (const h of state.hands) if (h.status === "playing") h.status = "stood";
    return settle(state);
  }
  if (state.hands[0]!.status === "blackjack") {
    state.holeRevealed = true;
    return settle(state);
  }
  state.phase = "player";
  return state;
}

export function allowedActions(state: EngineState): BlackjackAction[] {
  if (state.phase === "insurance") return ["insurance", "no_insurance"];
  if (state.phase !== "player") return [];
  const hand = state.hands[state.active];
  if (!hand || hand.status !== "playing") return [];

  const out: BlackjackAction[] = ["hit", "stand"];
  const two = hand.cards.length === 2;
  if (two && !hand.splitAces && (!hand.fromSplit || RULES.doubleAfterSplit)) out.push("double");
  if (
    two &&
    state.hands.length < RULES.maxHands &&
    blackjackValue(hand.cards[0]!.code) === blackjackValue(hand.cards[1]!.code) &&
    !(hand.fromSplit && rankOf(hand.cards[0]!.code) === "A" && !RULES.resplitAces)
  ) {
    out.push("split");
  }
  return out;
}

export function act(prev: EngineState, action: BlackjackAction, draw: Draw): ActResult {
  if (!allowedActions(prev).includes(action)) {
    throw new GameError(400, "ILLEGAL_ACTION", `Can't ${action.replace("_", " ")} right now`);
  }
  const state = clone(prev);
  let debit = 0;

  if (action === "insurance" || action === "no_insurance") {
    state.insurance.taken = action === "insurance";
    if (state.insurance.taken) debit = state.insurance.stake;
    return { state: afterPeek(state), debit };
  }

  const hand = state.hands[state.active]!;
  switch (action) {
    case "hit": {
      hand.cards.push(take(state, draw));
      settleHandTotal(hand);
      break;
    }
    case "stand":
      hand.status = "stood";
      break;
    case "double": {
      debit = hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(take(state, draw));
      settleHandTotal(hand);
      if (hand.status === "playing") hand.status = "stood";
      break;
    }
    case "split": {
      debit = hand.bet;
      const [first, second] = hand.cards as [EngineCard, EngineCard];
      const aces = rankOf(first.code) === "A";
      const left = newHand(hand.bet, [first], true);
      const right = newHand(hand.bet, [second], true);
      state.hands.splice(state.active, 1, left, right);
      if (aces) {
        // Split aces receive exactly one card each and are done.
        for (const h of [left, right]) {
          h.splitAces = true;
          h.cards.push(take(state, draw));
          h.status = "stood";
        }
      } else {
        left.cards.push(take(state, draw));
        if (handValue(codes(left.cards)).total === 21) left.status = "stood";
      }
      break;
    }
  }
  return { state: advance(state, draw), debit };
}

function settleHandTotal(hand: EngineHand) {
  const { total } = handValue(codes(hand.cards));
  if (total > 21) hand.status = "bust";
  else if (total === 21) hand.status = "stood";
}

/** Move to the next unfinished hand (dealing split hands their second card), or finish the round. */
function advance(state: EngineState, draw: Draw): EngineState {
  while (state.active < state.hands.length) {
    const hand = state.hands[state.active]!;
    if (hand.cards.length === 1) {
      hand.cards.push(take(state, draw));
      if (handValue(codes(hand.cards)).total === 21) hand.status = "stood";
    }
    if (hand.status === "playing") return state;
    state.active++;
  }
  state.active = state.hands.length - 1;
  return dealerPlay(state, draw);
}

function dealerPlay(state: EngineState, draw: Draw): EngineState {
  state.holeRevealed = true;
  const anyLive = state.hands.some((h) => h.status !== "bust");
  if (anyLive) {
    for (;;) {
      const { total, soft } = handValue(codes(state.dealer));
      if (total > 17 || (total === 17 && !(soft && RULES.dealerHitsSoft17))) break;
      state.dealer.push(take(state, draw));
    }
  }
  return settle(state);
}

function settle(state: EngineState): EngineState {
  const dealer = handValue(codes(state.dealer));
  const dealerBJ = state.dealer.length === 2 && dealer.total === 21;
  const { num, den } = RULES.blackjackPayout;

  for (const hand of state.hands) {
    const player = handValue(codes(hand.cards)).total;
    let result: HandResult;
    if (hand.status === "bust") result = "lose";
    else if (hand.status === "blackjack") result = dealerBJ ? "push" : "blackjack";
    else if (dealerBJ) result = "lose";
    else if (dealer.total > 21 || player > dealer.total) result = "win";
    else if (player === dealer.total) result = "push";
    else result = "lose";

    hand.result = result;
    hand.payout =
      result === "blackjack"
        ? hand.bet + Math.floor((hand.bet * num) / den)
        : result === "win"
          ? hand.bet * 2
          : result === "push"
            ? hand.bet
            : 0;
  }
  if (state.insurance.offered && state.insurance.payout === null) state.insurance.payout = 0;
  state.phase = "settled";
  return state;
}

export function totalStaked(state: EngineState): number {
  return state.hands.reduce((s, h) => s + h.bet, 0) + (state.insurance.taken ? state.insurance.stake : 0);
}

export function totalPayout(state: EngineState): number {
  return state.hands.reduce((s, h) => s + (h.payout ?? 0), 0) + (state.insurance.payout ?? 0);
}
