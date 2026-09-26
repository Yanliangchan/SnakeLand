import { describe, expect, it } from "vitest";
import { fairFloats, fairShuffle, hashServerSeed, verifyCommit } from "../src/fair";
import { applyMultiplier } from "../src/money";

const SEED = "a".repeat(64);

describe("provably fair", () => {
  it("commits with sha256 of the seed bytes", () => {
    const commit = hashServerSeed(SEED);
    expect(commit).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCommit(SEED, commit)).toBe(true);
    expect(verifyCommit("b".repeat(64), commit)).toBe(false);
  });

  it("is deterministic and bounded", () => {
    const a = fairFloats(SEED, "client", 7, 50);
    const b = fairFloats(SEED, "client", 7, 50);
    expect(a).toEqual(b);
    expect(a).toHaveLength(50);
    for (const f of a) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(fairFloats(SEED, "client", 8, 50)).not.toEqual(a);
    expect(fairFloats(SEED, "other", 7, 50)).not.toEqual(a);
  });

  it("rejects malformed seeds", () => {
    expect(() => hashServerSeed("xyz")).toThrow();
    expect(() => fairFloats("A".repeat(64), "c", 0, 1)).toThrow();
  });

  it("shuffles into a permutation", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = fairShuffle(items, fairFloats(SEED, "c", 0, 51));
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });
});

describe("applyMultiplier", () => {
  it("floors to whole chips without float drift", () => {
    expect(applyMultiplier(100, 1.15)).toBe(115);
    expect(applyMultiplier(333, 1.5)).toBe(499);
    expect(applyMultiplier(10, 0)).toBe(0);
    expect(() => applyMultiplier(1.5, 2)).toThrow();
  });
});
