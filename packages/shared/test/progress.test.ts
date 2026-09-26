import { describe, expect, it } from "vitest";
import { DAILY_CLAIM_AMOUNT, claimTerms, titleForWeeklyRank, weekKey, weekStart } from "../src";

describe("progress rules", () => {
  it("scales the daily claim by all-time rank", () => {
    expect(claimTerms(1)).toEqual({ amount: 1_200, cooldownHours: 12, reasons: ["All-time #1: +20%, every 12h"] });
    expect(claimTerms(2)).toMatchObject({ amount: 1_100, cooldownHours: 24 });
    expect(claimTerms(3)).toMatchObject({ amount: 1_050, cooldownHours: 24 });
    expect(claimTerms(4)).toEqual({ amount: DAILY_CLAIM_AMOUNT, cooldownHours: 24, reasons: [] });
    expect(claimTerms(null).amount).toBe(DAILY_CLAIM_AMOUNT);
  });

  it("names the weekly top 3", () => {
    expect([1, 2, 3, 4, null].map(titleForWeeklyRank)).toEqual(["Snake King", "Black Mamba", "Viper", null, null]);
  });

  it("starts weeks on Monday 00:00 UTC", () => {
    const start = weekStart(weekKey(new Date("2026-09-26T12:00:00Z")));
    expect(start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });
});
