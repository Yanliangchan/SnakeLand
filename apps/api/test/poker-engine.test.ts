import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POKER_RAKE, hashServerSeed, orderedShoe, shuffleShoe, type Card } from "@snakeland/shared";
import { decide, chen, equity } from "../src/games/poker/bots";
import {
  act,
  buildPots,
  emptyTable,
  nextStreet,
  startHand,
  timeOut,
  type SeatState,
  type TableState,
} from "../src/games/poker/engine";

const blinds = { sb: 10, bb: 20 };
const now = new Date("2026-01-01T00:00:00Z");

function seat(kind: "human" | "bot", stack: number, name: string = kind): SeatState {
  return { kind, userId: kind === "human" ? `u-${name}` : null, name, style: kind === "bot" ? "tight" : null, stack, sessionId: null, leaving: false, timeouts: 0 };
}

function table(stacks: Array<[number, "human" | "bot"] | null>): TableState {
  const t = emptyTable();
  stacks.forEach((s, i) => (t.seats[i] = s ? seat(s[1], s[0], `p${i}`) : null));
  return t;
}

function deal(t: TableState) {
  const seed = randomBytes(32).toString("hex");
  return startHand(t, blinds, { handId: randomUUID(), seed, commit: hashServerSeed(seed) }, now);
}

const chips = (t: TableState) => t.seats.reduce((s, x) => s + (x?.stack ?? 0), 0);
const inPlay = (t: TableState) =>
  (t.hand?.pot ?? 0) + (t.hand?.players.reduce((s, p) => s + (p?.bet ?? 0), 0) ?? 0);

/** Drive the dealer's street pauses until someone has to act or the hand ends. */
function settle(t: TableState) {
  while (t.hand && !t.hand.ended && t.hand.toAct === null) nextStreet(t, now);
}

describe("poker engine", () => {
  it("posts blinds, deals two cards each and rebuilds the deck from the seed", () => {
    const t = table([[1000, "human"], [1000, "bot"], [1000, "bot"], null, [1000, "bot"], null]);
    const h = deal(t);
    expect(h.button).toBe(0);
    expect(h.players[1]!.bet).toBe(10); // small blind
    expect(h.players[2]!.bet).toBe(20); // big blind
    expect(h.toAct).toBe(4); // first after the big blind (seat 3 is empty)
    const dealt = h.players.flatMap((p) => p?.hole ?? []);
    expect(dealt).toHaveLength(8);
    expect(new Set(dealt).size).toBe(8);
    // Anyone with the revealed seed and the hand id gets the same deck.
    const rebuilt = shuffleShoe(orderedShoe(1), h.seed, h.id) as Card[];
    expect(rebuilt).toEqual(h.deck);
    expect(hashServerSeed(h.seed)).toBe(h.commit);
  });

  it("heads-up: the button posts the small blind, acts first preflop and last after", () => {
    const t = table([[1000, "human"], null, null, [1000, "bot"], null, null]);
    const h = deal(t);
    expect(h.button).toBe(0);
    expect(h.players[0]!.bet).toBe(10);
    expect(h.players[3]!.bet).toBe(20);
    expect(h.toAct).toBe(0);
    act(t, 0, { kind: "call" }, now);
    act(t, 3, { kind: "check" }, now);
    settle(t);
    expect(h.street).toBe("flop");
    expect(h.toAct).toBe(3);
  });

  it("everyone folding to the big blind gives it the blinds, no showdown, no rake", () => {
    const t = table([[1000, "human"], [1000, "human"], [1000, "human"], null, null, null]);
    const h = deal(t);
    act(t, 0, { kind: "fold" }, now);
    act(t, 1, { kind: "fold" }, now);
    expect(h.ended).toBe(true);
    expect(t.seats[2]!.stack).toBe(1010);
    expect(h.rake).toBe(0);
    expect(chips(t)).toBe(3000);
  });

  it("enforces the minimum raise, but lets a short stack go all-in", () => {
    const t = table([[1000, "human"], [1000, "bot"], [1000, "bot"], [35, "bot"], null, null]);
    const h = deal(t);
    expect(h.toAct).toBe(3);
    expect(() => act(t, 3, { kind: "raise", to: 30 }, now)).toThrow(/minimum/);
    act(t, 3, { kind: "allin" }, now); // 35: a short raise
    expect(h.currentBet).toBe(35);
    expect(h.minRaise).toBe(20); // not a full raise, so the minimum raise size stays
    expect(() => act(t, 0, { kind: "raise", to: 50 }, now)).toThrow(/minimum is 55/);
    act(t, 0, { kind: "raise", to: 100 }, now);
    expect(h.minRaise).toBe(65);
  });

  it("splits side pots by stack size and pays each to its best eligible hand", () => {
    const t = table([[100, "bot"], [300, "bot"], [1000, "bot"], null, null, null]);
    const h = deal(t);
    // Fix the cards: seat 0 has the nuts, then seat 1, then seat 2.
    h.players[0]!.hole = ["AS", "AH"];
    h.players[1]!.hole = ["KS", "KH"];
    h.players[2]!.hole = ["QS", "QH"];
    h.deck = [...h.deck.slice(0, h.deckPos), "2C", "AD", "7D", "3C", "9H", "4D", "JS", "5C", "8C"] as Card[];
    act(t, 0, { kind: "allin" }, now);
    act(t, 1, { kind: "allin" }, now);
    act(t, 2, { kind: "call" }, now);
    settle(t);
    expect(h.ended).toBe(true);
    const pots = h.pots;
    expect(pots).toEqual([
      { amount: 300, seats: [0, 1, 2] },
      { amount: 400, seats: [1, 2] },
    ]);
    // Seat 2's uncalled 700 comes straight back.
    expect(t.seats[0]!.stack).toBe(300);
    expect(t.seats[1]!.stack).toBe(400);
    expect(t.seats[2]!.stack).toBe(700);
    expect(chips(t)).toBe(1400);
  });

  it("rakes only pots two real players contest after the flop, capped", () => {
    // Two humans and a bot see a flop; a human wins.
    const t = table([[10_000, "human"], [10_000, "human"], [10_000, "bot"], null, null, null]);
    const h = deal(t);
    h.players[0]!.hole = ["AS", "AH"];
    h.players[1]!.hole = ["2C", "7D"];
    h.players[2]!.hole = ["3C", "8D"];
    // A board where the aces win: burn, K 9 4, burn, J, burn, T.
    h.deck = [...h.deck.slice(0, h.deckPos), "2D", "KC", "9S", "4H", "5D", "JD", "6S", "TC"] as Card[];
    act(t, 0, { kind: "raise", to: 2000 }, now);
    act(t, 1, { kind: "call" }, now);
    act(t, 2, { kind: "call" }, now);
    settle(t);
    while (!h.ended) {
      act(t, h.toAct!, { kind: "check" }, now);
      settle(t);
    }
    // 6000 pot: 2.5% is 150, but the cap is 3 big blinds = 60.
    expect(h.rake).toBe(POKER_RAKE.capBB * blinds.bb);
    expect(chips(t) + h.rake).toBe(30_000);

    // One human against bots: no rake.
    const t2 = table([[10_000, "human"], [10_000, "bot"], [10_000, "bot"], null, null, null]);
    const h2 = deal(t2);
    act(t2, 0, { kind: "call" }, now);
    act(t2, 1, { kind: "call" }, now);
    act(t2, 2, { kind: "check" }, now);
    settle(t2);
    while (!h2.ended) {
      act(t2, h2.toAct!, { kind: "check" }, now);
      settle(t2);
    }
    expect(h2.rake).toBe(0);
    expect(chips(t2)).toBe(30_000);
  });

  it("times a player out: checks when free, folds otherwise, stands them up after two", () => {
    const t = table([[1000, "human"], [1000, "bot"], [1000, "bot"], null, null, null]);
    let h = deal(t);
    expect(h.toAct).toBe(0);
    timeOut(t, now);
    expect(h.players[0]!.folded).toBe(true);
    expect(t.seats[0]!.timeouts).toBe(1);
    // Finish the hand.
    while (!h.ended) {
      if (h.toAct === null) settle(t);
      else act(t, h.toAct, { kind: h.players[h.toAct]!.bet < h.currentBet ? "call" : "check" }, now);
    }
    h = deal(t);
    while (h.toAct !== 0 && !h.ended) act(t, h.toAct!, { kind: "call" }, now);
    if (!h.ended) timeOut(t, now);
    expect(t.seats[0]!.leaving).toBe(true);
  });

  it("buildPots treats the top layer only one player reached as a refund", () => {
    const t = table([[1000, "bot"], [500, "bot"], null, null, null, null]);
    const h = deal(t);
    h.players[0]!.contributed = 800;
    h.players[1]!.contributed = 500;
    const pots = buildPots(h);
    expect(pots.map((p) => [p.amount, p.refund])).toEqual([
      [1000, false],
      [300, true],
    ]);
  });

  it("bots play thousands of chips' worth of hands without breaking a rule or losing a chip", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const t = table([[2000, "bot"], [2000, "bot"], [2000, "bot"], [2000, "bot"], [2000, "bot"], [2000, "bot"]]);
    t.seats.forEach((s, i) => (s!.style = (["loose", "tight", "aggressive"] as const)[i % 3]!));
    const total = chips(t);
    let rake = 0;
    for (let n = 0; n < 150; n++) {
      if (t.seats.filter((s) => s && s.stack > 0).length < 2) break;
      const h = deal(t);
      let guard = 0;
      while (!h.ended && guard++ < 200) {
        if (h.toAct === null) settle(t);
        else act(t, h.toAct, decide(t, h.toAct, rand), now);
        expect(chips(t) + inPlay(t) + rake).toBe(total);
      }
      expect(h.ended).toBe(true);
      rake += h.rake;
      expect(h.rake).toBe(0); // no humans, never any rake
      expect(chips(t)).toBe(total);
    }
  });
});

describe("bot judgement", () => {
  it("ranks starting hands sensibly", () => {
    expect(chen(["AS", "AH"])).toBe(20);
    expect(chen(["AS", "KS"])).toBeGreaterThan(chen(["AS", "KD"]));
    expect(chen(["7C", "2D"])).toBeLessThan(2);
  });

  it("estimates equity: aces are big favourites, a made flush is near certain", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    expect(equity(["AS", "AH"], [], 1, 600, rand)).toBeGreaterThan(0.78);
    expect(equity(["7C", "2D"], [], 1, 600, rand)).toBeLessThan(0.4);
    expect(equity(["AH", "KH"], ["2H", "7H", "9H"], 1, 300, rand)).toBeGreaterThan(0.9);
  });
});
