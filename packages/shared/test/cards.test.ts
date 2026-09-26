import { describe, expect, it } from "vitest";
import { handValue, isCard, orderedShoe } from "../src/cards";

describe("cards", () => {
  it("builds a full shoe", () => {
    const shoe = orderedShoe(6);
    expect(shoe).toHaveLength(312);
    expect(new Set(shoe).size).toBe(52);
    expect(shoe.every(isCard)).toBe(true);
  });

  it("values hands with soft aces", () => {
    expect(handValue(["AS", "KD"])).toEqual({ total: 21, soft: true });
    expect(handValue(["AS", "6D"])).toEqual({ total: 17, soft: true });
    expect(handValue(["AS", "6D", "9C"])).toEqual({ total: 16, soft: false });
    expect(handValue(["AS", "AD"])).toEqual({ total: 12, soft: true });
    expect(handValue(["AS", "AD", "9C"])).toEqual({ total: 21, soft: true });
    expect(handValue(["TS", "QD", "2C"])).toEqual({ total: 22, soft: false });
    expect(handValue([])).toEqual({ total: 0, soft: false });
  });
});
