import { describe, expect, it } from "vitest";
import { bestHand, pokerLegal, type Card, type PokerTableDTO } from "../src";

const h = (s: string) => bestHand(s.split(" ") as Card[]);

describe("bestHand", () => {
  it("names and ranks every category", () => {
    const ladder = [
      ["2S 5D 9H JC KD 3C 7H", "High card", "King high"],
      ["2S 2D 9H JC KD 3C 7H", "Pair", "Pair of Twos"],
      ["2S 2D 9H 9C KD 3C 7H", "Two pair", "Two pair, Nines and Twos"],
      ["2S 2D 2H 9C KD 3C 7H", "Three of a kind", "Three Twos"],
      ["2S 3D 4H 5C 6D KC KH", "Straight", "Straight, Six high"],
      ["2S 9S 4S 5S JS KC KH", "Flush", "Flush, Jack high"],
      ["2S 2D 2H 9C 9D 3C 7H", "Full house", "Full house, Twos over Nines"],
      ["2S 2D 2H 2C KD 3C 7H", "Four of a kind", "Four Twos"],
      ["5H 6H 7H 8H 9H KC KD", "Straight flush", "Straight flush, Nine high"],
    ] as const;
    let prev = -1;
    for (const [cards, cat, name] of ladder) {
      const s = h(cards);
      expect(s.category).toBe(cat);
      expect(s.name).toBe(name);
      expect(s.score).toBeGreaterThan(prev);
      prev = s.score;
    }
    expect(h("TS JS QS KS AS 2D 3C").name).toBe("Royal flush");
  });

  it("treats A-2-3-4-5 as a five-high straight, below 2-6", () => {
    const wheel = h("AS 2D 3H 4C 5D KC KH");
    expect(wheel.category).toBe("Straight");
    expect(wheel.name).toBe("Straight, Five high");
    expect(h("2S 3D 4H 5C 6D KC KH").score).toBeGreaterThan(wheel.score);
    // A-K-Q-J-T beats both.
    expect(h("AS KD QH JC TD 2C 3H").score).toBeGreaterThan(h("9S KD QH JC TD 2C 3H").score);
    // No wrap-around: Q-K-A-2-3 is just ace high.
    expect(h("QS KD AH 2C 3D 8C 9H").category).toBe("High card");
  });

  it("compares kickers", () => {
    // Same pair, better kicker wins.
    expect(h("AS AD KH 7C 4D 3C 2H").score).toBeGreaterThan(h("AS AD QH 7C 4D 3C 2H").score);
    // Two pair: the fifth card decides.
    expect(h("KS KD 9H 9C AD 3C 2H").score).toBeGreaterThan(h("KS KD 9H 9C QD 3C 2H").score);
    // Identical best five split the pot (the board plays).
    expect(h("AS KS QS JS 9D 2C 3H").score).toBe(h("AS KS QS JS 9D 4C 5H").score);
  });

  it("picks the best five of seven", () => {
    // A flush beats the straight also on the board.
    const s = h("4H 5H 6H 7C 8H 2H KD");
    expect(s.category).toBe("Flush");
    expect(s.best).toHaveLength(5);
    // Two trips make a full house with the higher trips on top.
    expect(h("9S 9D 9H 4C 4D 4H KD").name).toBe("Full house, Nines over Fours");
  });
});

describe("pokerLegal", () => {
  const table = (over: Partial<PokerTableDTO["hand"]> = {}, bet = 0, stack = 1000): PokerTableDTO => ({
    id: "low",
    name: "Low",
    sb: 10,
    bb: 20,
    version: 1,
    players: 1,
    seats: [
      {
        seat: 0,
        player: { kind: "human", userId: "u", name: "Me", stack, leaving: false, sittingOut: false },
        reservedFor: null,
        inHand: true,
        folded: false,
        allIn: false,
        bet,
        shown: null,
        holding: 2,
        lastAction: null,
        won: null,
        handName: null,
      },
    ],
    hand: {
      id: "h",
      number: 1,
      commit: "c",
      seed: null,
      button: 0,
      board: [],
      street: "preflop",
      pot: 0,
      pots: [],
      toAct: 0,
      deadline: null,
      currentBet: 20,
      minRaiseTo: 40,
      rake: 0,
      winners: [],
      ...over,
    },
  });

  it("calls the difference and raises from the minimum to all-in", () => {
    const l = pokerLegal(table({}, 10), 0)!;
    expect(l.canCheck).toBe(false);
    expect(l.callAmount).toBe(10);
    expect(l.raise).toEqual({ min: 40, max: 1010 });
  });

  it("caps a call at the stack and offers no raise when it can't exceed the bet", () => {
    const l = pokerLegal(table({ currentBet: 500 }, 0, 300), 0)!;
    expect(l.callAmount).toBe(300);
    expect(l.raise).toBeNull();
  });

  it("is null when it isn't your turn", () => {
    expect(pokerLegal(table({ toAct: 3 }), 0)).toBeNull();
  });
});
