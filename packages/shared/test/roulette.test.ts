import { describe, expect, it } from "vitest";
import { ROULETTE_BETS, WHEEL_ORDER, pocketColor, rouletteResult, rouletteReturn } from "../src/roulette";

describe("roulette", () => {
  it("has a complete European wheel", () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual([...Array(37).keys()]);
    expect([...Array(37).keys()].filter((n) => pocketColor(n) === "red")).toHaveLength(18);
  });

  it("catalogues the standard bets", () => {
    const count = (k: string) => [...ROULETTE_BETS.values()].filter((b) => b.kind === k).length;
    expect(count("straight")).toBe(37);
    expect(count("split")).toBe(57 + 3); // 24 vertical + 33 horizontal + 3 zero splits
    expect(count("street")).toBe(12);
    expect(count("corner")).toBe(22);
    expect(count("line")).toBe(11);
    expect(count("trio")).toBe(2);
    expect(count("first-four")).toBe(1);
    expect(count("dozen")).toBe(3);
    expect(count("column")).toBe(3);
    expect(ROULETTE_BETS.get("corner:17-18-20-21")?.numbers).toEqual([17, 18, 20, 21]);
    expect(ROULETTE_BETS.get("split:17-19")).toBeUndefined(); // not adjacent on the layout
  });

  it("pays 36/n and gives every bet the same 2.70% edge", () => {
    expect(rouletteReturn("straight:17", 10, 17)).toBe(360);
    expect(rouletteReturn("split:17-20", 10, 20)).toBe(180);
    expect(rouletteReturn("red", 10, 1)).toBe(20);
    expect(rouletteReturn("red", 10, 0)).toBe(0);
    expect(rouletteReturn("dozen:3", 10, 36)).toBe(30);
    for (const bet of ROULETTE_BETS.values()) {
      let total = 0;
      for (let n = 0; n <= 36; n++) total += rouletteReturn(bet.id, 36, n);
      expect(total / 37 / 36).toBeCloseTo(36 / 37, 10);
      expect(Number.isInteger(rouletteReturn(bet.id, 10, bet.numbers[0]!))).toBe(true);
    }
  });

  it("spins uniformly and deterministically", () => {
    const seed = "d".repeat(64);
    expect(rouletteResult(seed, "r1")).toBe(rouletteResult(seed, "r1"));
    const counts = new Array(37).fill(0);
    for (let i = 0; i < 37_000; i++) counts[rouletteResult(seed, `r${i}`)]++;
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(160);
  });
});
