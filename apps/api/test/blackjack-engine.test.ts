import { describe, expect, it } from "vitest";
import type { Card } from "@snakeland/shared";
import { act, allowedActions, deal, totalPayout, totalStaked, type EngineState } from "../src/games/blackjack/engine";

/** Scripted shoe. Deal order: player, dealer up, player, dealer hole, then hits. */
function shoe(...cards: Card[]) {
  let i = 0;
  const draw = () => {
    const c = cards[i++];
    if (!c) throw new Error("script ran out of cards");
    return c;
  };
  return { draw, used: () => i };
}

function play(state: EngineState, actions: Parameters<typeof act>[1][], draw: () => Card) {
  let debit = 0;
  for (const a of actions) {
    const r = act(state, a, draw);
    state = r.state;
    debit += r.debit;
  }
  return { state, debit };
}

describe("blackjack engine", () => {
  it("pays a natural 3:2 without the dealer drawing", () => {
    const s = shoe("AS", "9D", "KH", "7C");
    const state = deal(100, s.draw);
    expect(state.phase).toBe("settled");
    expect(state.hands[0]!.result).toBe("blackjack");
    expect(totalPayout(state)).toBe(250);
    expect(s.used()).toBe(4);
  });

  it("floors the 3:2 payout on odd bets", () => {
    const state = deal(15, shoe("AS", "9D", "KH", "7C").draw);
    expect(totalPayout(state)).toBe(15 + 22);
  });

  it("peeks under a ten: dealer blackjack ends the round before the player acts", () => {
    const state = deal(100, shoe("9S", "KD", "9H", "AC").draw);
    expect(state.phase).toBe("settled");
    expect(state.holeRevealed).toBe(true);
    expect(state.hands[0]!.result).toBe("lose");
    expect(totalPayout(state)).toBe(0);
  });

  it("pushes player blackjack against dealer blackjack", () => {
    const state = deal(100, shoe("AS", "KD", "QH", "AC").draw);
    expect(state.hands[0]!.result).toBe("push");
    expect(totalPayout(state)).toBe(100);
  });

  it("dealer stands on soft 17", () => {
    const s = shoe("TS", "AD", "8H", "6C");
    let state = deal(100, s.draw);
    expect(state.phase).toBe("insurance");
    state = act(state, "no_insurance", s.draw).state;
    state = act(state, "stand", s.draw).state;
    expect(state.dealer).toHaveLength(2);
    expect(state.hands[0]!.result).toBe("win");
  });

  it("dealer hits 16 and can bust", () => {
    const s = shoe("TS", "TD", "8H", "6C", "9S");
    let state = deal(100, s.draw);
    state = act(state, "stand", s.draw).state;
    expect(state.dealer.map((c) => c.code)).toEqual(["TD", "6C", "9S"]);
    expect(state.hands[0]!.result).toBe("win");
    expect(totalPayout(state)).toBe(200);
  });

  it("busts on hit and the dealer does not draw", () => {
    const s = shoe("TS", "TD", "6H", "6C", "9S");
    let state = deal(100, s.draw);
    state = act(state, "hit", s.draw).state;
    expect(state.hands[0]!.status).toBe("bust");
    expect(state.phase).toBe("settled");
    expect(state.dealer).toHaveLength(2);
    expect(totalPayout(state)).toBe(0);
  });

  it("auto-stands on 21", () => {
    const s = shoe("TS", "9D", "6H", "7C", "5S", "2S");
    let state = deal(100, s.draw);
    state = act(state, "hit", s.draw).state; // 21: no further action needed
    expect(state.phase).toBe("settled");
    expect(state.dealer.map((c) => c.code)).toEqual(["9D", "7C", "2S"]);
    expect(state.hands[0]!.result).toBe("win");
  });

  it("doubles for one card and double stake", () => {
    const s = shoe("5S", "9D", "6H", "7C", "TS", "2D");
    let state = deal(100, s.draw);
    expect(allowedActions(state)).toContain("double");
    const r = act(state, "double", s.draw);
    state = r.state;
    expect(r.debit).toBe(100);
    expect(state.hands[0]!.bet).toBe(200);
    expect(state.hands[0]!.cards).toHaveLength(3);
    // dealer 16 draws 2 -> 18; player 21 wins
    expect(state.hands[0]!.result).toBe("win");
    expect(totalPayout(state)).toBe(400);
    expect(totalStaked(state)).toBe(200);
  });

  it("does not allow double after three cards", () => {
    const s = shoe("2S", "9D", "3H", "7C", "4S");
    let state = deal(100, s.draw);
    state = act(state, "hit", s.draw).state;
    expect(allowedActions(state)).not.toContain("double");
    expect(() => act(state, "double", s.draw)).toThrow(/Can't double/);
  });

  it("splits a pair, deals each hand its second card in turn, and allows double after split", () => {
    const s = shoe("8S", "6D", "8H", "TC", "3S", "TD", "9C", "5H");
    let state = deal(100, s.draw);
    expect(allowedActions(state)).toContain("split");
    let r = act(state, "split", s.draw);
    state = r.state;
    expect(r.debit).toBe(100);
    expect(state.hands).toHaveLength(2);
    expect(state.hands[0]!.cards.map((c) => c.code)).toEqual(["8S", "3S"]);
    expect(state.hands[1]!.cards).toHaveLength(1);
    expect(allowedActions(state)).toContain("double");
    r = act(state, "double", s.draw); // 8+3+TD = 21
    state = r.state;
    expect(r.debit).toBe(100);
    expect(state.active).toBe(1);
    expect(state.hands[1]!.cards.map((c) => c.code)).toEqual(["8H", "9C"]);
    state = act(state, "stand", s.draw).state; // dealer 16 draws 5 -> 21
    expect(state.phase).toBe("settled");
    expect(state.hands.map((h) => h.result)).toEqual(["push", "lose"]);
    expect(totalStaked(state)).toBe(300);
    expect(totalPayout(state)).toBe(200);
  });

  it("21 after split is not a blackjack", () => {
    const s = shoe("KS", "9D", "KH", "8C", "AS", "7D");
    let state = deal(100, s.draw);
    state = act(state, "split", s.draw).state; // KS+AS = 21 auto-stand, KH gets 7D
    expect(state.hands[0]!.status).toBe("stood");
    state = act(state, "stand", s.draw).state;
    expect(state.hands[0]!.result).toBe("win");
    expect(state.hands[0]!.payout).toBe(200);
  });

  it("split aces get one card each and cannot be resplit", () => {
    const s = shoe("AS", "6D", "AH", "TC", "AD", "9C", "7H");
    let state = deal(100, s.draw);
    state = act(state, "split", s.draw).state;
    // Both ace hands are done; dealer 16 draws 7H -> 23 bust.
    expect(state.phase).toBe("settled");
    expect(state.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(state.hands.every((h) => h.splitAces)).toBe(true);
    expect(state.hands.map((h) => h.result)).toEqual(["win", "win"]);
  });

  it("resplits up to four hands and no further", () => {
    const s = shoe("8S", "6D", "8H", "TC", "8D", "8C", "8S", "TS", "TD", "TH", "TC", "TS");
    let state = deal(10, s.draw);
    state = act(state, "split", s.draw).state; // hands: [8S,8D] [8H]
    state = act(state, "split", s.draw).state; // [8S,8C] [8D] [8H]
    state = act(state, "split", s.draw).state; // [8S,8S] [8C] [8D] [8H]
    expect(state.hands).toHaveLength(4);
    expect(allowedActions(state)).not.toContain("split");
    expect(totalStaked(state)).toBe(40);
  });

  it("insurance pays 2:1 when the dealer has blackjack", () => {
    const s = shoe("TS", "AD", "9H", "KC");
    let state = deal(100, s.draw);
    expect(state.insurance).toMatchObject({ offered: true, stake: 50 });
    const r = act(state, "insurance", s.draw);
    state = r.state;
    expect(r.debit).toBe(50);
    expect(state.phase).toBe("settled");
    expect(state.insurance.payout).toBe(150);
    expect(totalStaked(state)).toBe(150);
    expect(totalPayout(state)).toBe(150); // insurance breaks even on the main bet loss
  });

  it("insurance is lost when the dealer has no blackjack, and play continues", () => {
    const s = shoe("TS", "AD", "9H", "5C", "TC", "5D");
    let state = deal(100, s.draw);
    state = act(state, "insurance", s.draw).state;
    expect(state.phase).toBe("player");
    expect(state.insurance.payout).toBe(0);
    state = act(state, "stand", s.draw).state; // dealer A5 (soft 16) +T = 16, +5 = 21
    expect(state.phase).toBe("settled");
    expect(state.hands[0]!.result).toBe("lose");
  });

  it("offers even money (insurance) on a player blackjack against an ace", () => {
    const s = shoe("AS", "AD", "KH", "7C");
    let state = deal(100, s.draw);
    expect(state.phase).toBe("insurance");
    state = act(state, "no_insurance", s.draw).state;
    expect(state.hands[0]!.result).toBe("blackjack");
    expect(totalPayout(state)).toBe(250);
  });

  it("rejects actions once settled", () => {
    const s = shoe("AS", "9D", "KH", "7C");
    const state = deal(100, s.draw);
    expect(allowedActions(state)).toEqual([]);
    expect(() => act(state, "hit", s.draw)).toThrow();
  });

  it("does not mutate the previous state", () => {
    const s = shoe("TS", "TD", "5H", "6C", "2S");
    const before = deal(100, s.draw);
    const snapshot = structuredClone(before);
    act(before, "hit", s.draw);
    expect(before).toEqual(snapshot);
  });

  it("assigns strictly increasing sequence numbers in draw order", () => {
    const s = shoe("8S", "6D", "8H", "TC", "3S", "TD", "9C", "5H");
    let state = deal(100, s.draw);
    state = play(state, ["split", "double", "stand"], s.draw).state;
    const all = [...state.hands.flatMap((h) => h.cards), ...state.dealer].map((c) => c.seq).sort((a, b) => a - b);
    expect(all).toEqual([...Array(8).keys()]);
  });
});

describe("blackjack engine (randomized)", () => {
  it("always terminates within rule-bounded payouts", async () => {
    const { orderedShoe, shuffleShoe } = await import("@snakeland/shared");
    let rng = 1;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const seedHex = (n: number) => n.toString(16).padStart(64, "0");

    for (let round = 0; round < 5000; round++) {
      const cards = shuffleShoe(orderedShoe(6), seedHex(round + 1), "fuzz");
      let i = 0;
      const draw = () => cards[i++]!;
      let state = deal(100, draw);
      let staked = 100;
      let steps = 0;
      while (state.phase !== "settled") {
        const options = allowedActions(state);
        expect(options.length).toBeGreaterThan(0);
        const r = act(state, options[Math.floor(rand() * options.length)]!, draw);
        state = r.state;
        staked += r.debit;
        expect(++steps).toBeLessThan(60);
      }
      expect(totalStaked(state)).toBe(staked);
      const payout = totalPayout(state);
      // Max: every hand doubled and won (2x of stake), a natural (2.5x), or insurance (3x of its stake).
      expect(payout).toBeLessThanOrEqual(staked * 3);
      expect(payout).toBeGreaterThanOrEqual(0);
      for (const h of state.hands) expect(h.result).not.toBeNull();
    }
  });
});
