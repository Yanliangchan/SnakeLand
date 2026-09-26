import { describe, expect, it } from "vitest";
import { baccaratReturn, orderedShoe, shuffleShoe, type Card } from "@snakeland/shared";
import { bankerDraws, dealCoup } from "../src/games/baccarat/engine";

function script(...cards: Card[]) {
  let i = 0;
  return () => {
    const c = cards[i++];
    if (!c) throw new Error("out of cards");
    return c;
  };
}

describe("baccarat tableau", () => {
  it("stands on naturals", () => {
    const h = dealCoup(script("4S", "2D", "5H", "3C")); // P 9, B 5
    expect(h.natural).toBe(true);
    expect(h.player).toHaveLength(2);
    expect(h.banker).toHaveLength(2);
    expect(h.winner).toBe("player");
  });

  it("player stands on 6-7; banker then draws on 0-5", () => {
    const h = dealCoup(script("3S", "2D", "4H", "3C", "2S")); // P 7 stands, B 5 draws 2 -> 7
    expect(h.player).toHaveLength(2);
    expect(h.banker.map((c) => c.code)).toEqual(["2D", "3C", "2S"]);
    expect(h.winner).toBe("tie");
  });

  it("player draws on 0-5", () => {
    const h = dealCoup(script("TS", "7D", "5H", "KC", "3S")); // P 5 draws -> 8, B 7 stands (p3=3)
    expect(h.player.map((c) => c.code)).toEqual(["TS", "5H", "3S"]);
    expect(h.banker).toHaveLength(2);
    expect(h.winner).toBe("player");
  });

  it("follows the banker third-card table exactly", () => {
    // [banker total, player third card points, draws?]
    const table: Array<[number, number | null, boolean]> = [];
    for (const p of [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      table.push([0, p, true], [1, p, true], [2, p, true]);
      table.push([3, p, p === null ? true : p !== 8]);
      table.push([4, p, p === null ? true : p >= 2 && p <= 7]);
      table.push([5, p, p === null ? true : p >= 4 && p <= 7]);
      table.push([6, p, p === null ? false : p === 6 || p === 7]);
      table.push([7, p, false]);
    }
    const card = (p: number): Card => (p === 0 ? "KS" : p === 1 ? "AS" : (`${p}S` as Card));
    for (const [bt, p, draws] of table) expect(bankerDraws(bt, p === null ? null : card(p))).toBe(draws);
  });

  it("detects pairs on the first two cards only", () => {
    const h = dealCoup(script("8S", "QD", "8H", "QC", "5D")); // P 6 stands, B 0 draws
    expect(h.playerPair).toBe(true);
    expect(h.bankerPair).toBe(true);
  });

  it("orders cards P, B, P, B, then third cards", () => {
    const h = dealCoup(script("2S", "3D", "2H", "3C", "6S", "5D")); // P 4 draws 6; B 6 draws on a 6
    expect(h.player.map((c) => c.seq)).toEqual([0, 2, 4]);
    expect(h.banker.map((c) => c.seq)).toEqual([1, 3, 5]);
  });
});

describe("baccarat payouts", () => {
  const o = (winner: "player" | "banker" | "tie", pairs = false) => ({ winner, playerPair: pairs, bankerPair: false });
  it("pays the standard table", () => {
    expect(baccaratReturn("player", 100, o("player"))).toBe(200);
    expect(baccaratReturn("banker", 100, o("banker"))).toBe(195);
    expect(baccaratReturn("banker", 10, o("banker"))).toBe(19);
    expect(baccaratReturn("tie", 100, o("tie"))).toBe(900);
    expect(baccaratReturn("player", 100, o("tie"))).toBe(100);
    expect(baccaratReturn("banker", 100, o("tie"))).toBe(100);
    expect(baccaratReturn("player", 100, o("banker"))).toBe(0);
    expect(baccaratReturn("playerPair", 100, o("banker", true))).toBe(1200);
    expect(baccaratReturn("bankerPair", 100, o("banker", true))).toBe(0);
  });

  it("has the textbook house edges over many simulated coups", () => {
    const N = 200_000;
    let p = 0,
      b = 0,
      t = 0;
    let shoe: Card[] = [];
    let i = 0;
    let seed = 0;
    const draw = () => {
      if (i >= shoe.length - 16 || shoe.length === 0) {
        shoe = shuffleShoe(orderedShoe(8), (++seed).toString(16).padStart(64, "0"), "sim");
        i = 0;
      }
      return shoe[i++]!;
    };
    for (let n = 0; n < N; n++) {
      const h = dealCoup(draw);
      if (h.winner === "player") p++;
      else if (h.winner === "banker") b++;
      else t++;
    }
    // Known probabilities (8 decks): banker 45.86%, player 44.62%, tie 9.52%.
    expect(b / N).toBeCloseTo(0.4586, 2);
    expect(p / N).toBeCloseTo(0.4462, 2);
    expect(t / N).toBeCloseTo(0.0952, 2);
  });
});
