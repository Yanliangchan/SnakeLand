import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { CRASH_MAX_X100, crashMultiplierAt, crashPayout, crashPointX100, crashTimeFor } from "../src";

describe("crash rules", () => {
  it("is deterministic per seed and round", () => {
    const seed = "ab".repeat(32);
    expect(crashPointX100(seed, "round-1")).toBe(crashPointX100(seed, "round-1"));
    expect(crashPointX100(seed, "round-1")).toBeGreaterThanOrEqual(100);
  });

  it("returns about 99% for any cash-out target", () => {
    const n = 20_000;
    const points = Array.from({ length: n }, (_, i) => crashPointX100(randomBytes(32).toString("hex"), `r${i}`));
    for (const target of [101, 150, 200, 500, 1000]) {
      const wins = points.filter((p) => p >= target).length / n;
      const expected = 99 / target;
      expect(Math.abs(wins - expected)).toBeLessThan(0.02);
    }
    // Instant crashes at 1.00×: r < 0.01, plus the 1% that floors into [1.00, 1.01).
    expect(Math.abs(points.filter((p) => p === 100).length / n - 0.0198)).toBeLessThan(0.006);
    expect(Math.max(...points)).toBeLessThanOrEqual(CRASH_MAX_X100);
  });

  it("maps time to multiplier and back", () => {
    expect(crashMultiplierAt(0)).toBe(100);
    for (const x of [101, 200, 1000, 50_000]) {
      const t = crashTimeFor(x);
      expect(crashMultiplierAt(t)).toBeGreaterThanOrEqual(x);
      expect(crashMultiplierAt(t - 2)).toBeLessThan(x);
    }
    expect(crashTimeFor(200)).toBeGreaterThan(11_000);
    expect(crashPayout(333, 150)).toBe(499);
  });
});
