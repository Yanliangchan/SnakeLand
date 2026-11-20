import { bestHand, cardValue, orderedShoe, suitOf, type BotStyle, type Card } from "@snakeland/shared";
import type { ActionInput, TableState } from "./engine";

/**
 * House bots. Each seat gets a style so a table plays like a mix of people:
 *  - loose: plays lots of hands, calls too much, rarely raises (beatable)
 *  - tight: few hands, bets its good ones, folds the rest (solid)
 *  - aggressive: many hands, raises and bluffs often
 * Preflop uses the Chen formula; after the flop the bot estimates its equity
 * by simulating random run-outs against the players still in, and compares it
 * with the price of calling.
 */
interface Profile {
  /** Chen score to open-raise / to call a raise / to just limp or call the blind. */
  raisePre: number;
  callPre: number;
  limpPre: number;
  /** Equity to bet when checked to / to raise a bet. */
  bet: number;
  raise: number;
  /** Added to the pot odds needed to call (negative = calls too light). */
  callMargin: number;
  bluff: number;
}

const PROFILES: Record<BotStyle, Profile> = {
  loose: { raisePre: 11, callPre: 5, limpPre: 3, bet: 0.7, raise: 0.86, callMargin: -0.08, bluff: 0.04 },
  tight: { raisePre: 9, callPre: 8, limpPre: 7, bet: 0.6, raise: 0.78, callMargin: 0.04, bluff: 0.08 },
  aggressive: { raisePre: 6, callPre: 5, limpPre: 4, bet: 0.52, raise: 0.68, callMargin: 0, bluff: 0.25 },
};

/** Chen formula: a quick preflop hand score (about -1 to 20). */
export function chen(hole: readonly Card[]): number {
  const [a, b] = [...hole].sort((x, y) => cardValue(y) - cardValue(x)) as [Card, Card];
  const hi = cardValue(a);
  const lo = cardValue(b);
  const base = (v: number) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  if (hi === lo) return Math.max(5, base(hi) * 2);
  let score = base(hi);
  if (suitOf(a) === suitOf(b)) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/** Share of the pot this hand wins on average against `opponents` random hands. */
export function equity(hole: Card[], board: Card[], opponents: number, sims: number, rand: () => number): number {
  const known = new Set([...hole, ...board]);
  const rest = (orderedShoe(1) as Card[]).filter((c) => !known.has(c));
  let total = 0;
  for (let i = 0; i < sims; i++) {
    // Partial shuffle: only as many cards as this run-out needs.
    const need = opponents * 2 + (5 - board.length);
    for (let k = 0; k < need; k++) {
      const j = k + Math.floor(rand() * (rest.length - k));
      [rest[k], rest[j]] = [rest[j]!, rest[k]!];
    }
    const full = [...board, ...rest.slice(opponents * 2, need)];
    const mine = bestHand([...hole, ...full]).score;
    let beaten = false;
    let ties = 0;
    for (let o = 0; o < opponents && !beaten; o++) {
      const s = bestHand([rest[o * 2]!, rest[o * 2 + 1]!, ...full]).score;
      if (s > mine) beaten = true;
      else if (s === mine) ties++;
    }
    if (!beaten) total += 1 / (ties + 1);
  }
  return total / sims;
}

const SIMS = 140;

export function decide(t: TableState, seat: number, rand: () => number = Math.random): ActionInput {
  const h = t.hand!;
  const me = h.players[seat]!;
  const style = t.seats[seat]!.style ?? "tight";
  const prof = PROFILES[style];
  const stack = t.seats[seat]!.stack;
  const toCall = Math.max(0, h.currentBet - me.bet);
  const pot = h.pot + h.players.reduce((sum, p) => sum + (p?.bet ?? 0), 0);
  const maxTo = me.bet + stack;
  const minTo = h.currentBet + h.minRaise;

  const raiseTo = (to: number): ActionInput => {
    const target = Math.max(minTo, Math.round(to / h.bb) * h.bb);
    if (target >= maxTo || maxTo <= h.currentBet) return maxTo > h.currentBet ? { kind: "allin" } : toCall > 0 ? { kind: "call" } : { kind: "check" };
    return { kind: h.currentBet === 0 ? "bet" : "raise", to: target };
  };
  const passive = (): ActionInput => (toCall === 0 ? { kind: "check" } : { kind: "fold" });
  const call = (): ActionInput => (toCall === 0 ? { kind: "check" } : { kind: "call" });

  if (h.street === "preflop") {
    const score = chen(me.hole) + (rand() < 0.15 ? 1 : 0); // a little noise so bots aren't predictable
    const raised = h.currentBet > h.bb;
    if (score >= prof.raisePre + (raised ? 2 : 0)) {
      // Open to ~3 big blinds, or re-raise to ~3x the bet.
      return raiseTo(raised ? h.currentBet * 3 : h.bb * (2.5 + rand()));
    }
    const cheap = toCall <= Math.max(h.bb, stack * (style === "loose" ? 0.15 : 0.08));
    if (raised ? score >= prof.callPre && cheap : score >= prof.limpPre) return call();
    if (style === "aggressive" && !raised && rand() < 0.15) return raiseTo(h.bb * 3);
    return passive();
  }

  const opponents = Math.max(1, h.players.filter((p, s) => p && !p.folded && s !== seat).length);
  const eq = equity(me.hole, h.board, opponents, SIMS, rand);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  if (toCall === 0) {
    if (eq >= prof.bet || rand() < prof.bluff) return raiseTo(pot * (0.5 + rand() * 0.3));
    return { kind: "check" };
  }
  if (eq >= prof.raise) return raiseTo(h.currentBet + pot * (0.6 + rand() * 0.4));
  if (eq >= potOdds + prof.callMargin) return call();
  // The odd float with nothing, so bots can be bluffed but aren't sure folds.
  if (style !== "tight" && toCall <= pot * 0.25 && rand() < 0.15) return call();
  return passive();
}

const FIRST = ["Mara", "Jonah", "Priya", "Leo", "Ines", "Kofi", "Hana", "Ravi", "Sofia", "Theo", "Yuki", "Omar", "Lena", "Diego", "Aisha", "Finn", "Nadia", "Ezra"];
const STYLES: BotStyle[] = ["loose", "tight", "aggressive", "loose", "tight", "loose"];

/** A bot for an empty seat: a name not already at the table and a style. */
export function newBot(t: TableState, seat: number, rand: () => number = Math.random): { name: string; style: BotStyle } {
  const taken = new Set(t.seats.flatMap((s) => (s ? [s.name] : [])));
  const free = FIRST.filter((n) => !taken.has(n));
  const name = free[Math.floor(rand() * free.length)] ?? `Player ${seat + 1}`;
  return { name, style: STYLES[(seat + t.handNumber) % STYLES.length]! };
}
