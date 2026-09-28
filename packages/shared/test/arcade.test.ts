import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  CARRIER_MODES,
  CROSSING_CONFIG,
  CROSSING_MODES,
  TOWER_CONFIG,
  TOWER_FLOORS,
  TOWER_MODES,
  carrierExactRtp,
  carrierFlight,
  carrierLandChance,
  crossingHitLane,
  ladderMultiplierX100,
  towerLayout,
} from "../src";

const seed = () => randomBytes(32).toString("hex");

describe("Carrier", () => {
  it("returns at most 99% in every mode, and close to it", () => {
    for (const mode of CARRIER_MODES) {
      const rtp = carrierExactRtp(mode);
      expect(rtp).toBeLessThanOrEqual(0.99);
      expect(rtp).toBeGreaterThan(0.955);
      expect(carrierLandChance(mode)).toBeGreaterThan(0.2);
      expect(carrierLandChance(mode)).toBeLessThan(0.7);
    }
  });

  it("lands less often on longer flights", () => {
    const chances = CARRIER_MODES.map(carrierLandChance);
    expect([...chances].sort((a, b) => b - a)).toEqual(chances);
  });

  it("is deterministic and pays only on landing", () => {
    const s = seed();
    const a = carrierFlight(s, "client", "normal");
    expect(carrierFlight(s, "client", "normal")).toEqual(a);
    expect(a.events).toHaveLength(6);
    expect(a.multiplierX100).toBe(a.landed ? a.finalX100 : 0);
    expect(a.events.at(-1)!.x100).toBe(a.finalX100);
  });
});

describe("Tower", () => {
  it("has the right number of safe doors on every floor", () => {
    for (const mode of TOWER_MODES) {
      const layout = towerLayout(seed(), "c", mode);
      expect(layout).toHaveLength(TOWER_FLOORS);
      for (const floor of layout) {
        expect(floor).toHaveLength(TOWER_CONFIG[mode].safe);
        expect(new Set(floor).size).toBe(floor.length);
        for (const d of floor) expect(d).toBeLessThan(TOWER_CONFIG[mode].doors);
      }
    }
  });

  it("pays 99% ÷ survival odds", () => {
    expect(ladderMultiplierX100("tower", "hard", 1)).toBe(198);
    expect(ladderMultiplierX100("tower", "easy", 2)).toBe(176); // 99 × 16/9
    expect(ladderMultiplierX100("tower", "expert", 8)).toBe(649_539); // 99 × 3^8
    expect(ladderMultiplierX100("tower", "medium", 0)).toBe(100);
  });
});

describe("Crossing", () => {
  it("hits at the per-lane rate", () => {
    const n = 4000;
    for (const mode of CROSSING_MODES) {
      const [num, den] = CROSSING_CONFIG[mode].survive;
      const firstLaneHits = Array.from({ length: n }, () => crossingHitLane(seed(), "c", mode)).filter((l) => l === 0).length;
      expect(Math.abs(firstLaneHits / n - (1 - num / den))).toBeLessThan(0.03);
    }
  });

  it("pays 99% ÷ survival odds", () => {
    expect(ladderMultiplierX100("crossing", "daredevil", 1)).toBe(165); // 99 × 5/3
    expect(ladderMultiplierX100("crossing", "easy", 1)).toBe(103); // 99 × 25/24
  });
});

describe("Penalty", () => {
  it("covers the right number of spots on every kick", async () => {
    const { PENALTY_CONFIG, PENALTY_KICKS, PENALTY_MODES, penaltyKeeper } = await import("../src");
    for (const mode of PENALTY_MODES) {
      const k = penaltyKeeper(seed(), "c", mode);
      expect(k).toHaveLength(PENALTY_KICKS);
      for (const kick of k) expect(kick).toHaveLength(PENALTY_CONFIG[mode].covered);
    }
    expect(ladderMultiplierX100("penalty", "hard", 3)).toBe(792); // 99 × 8
    expect(ladderMultiplierX100("penalty", "easy", 1)).toBe(123); // 99 × 5/4
  });
});

describe("Hi-Lo", () => {
  it("pays 99% ÷ the odds of each guess", async () => {
    const { hiloMultiplierX100, hiloNextX100, hiloWins } = await import("../src");
    // A King (rank 13): "lower or same" wins with every rank → no gain; "higher or same" only another King.
    const king = 12;
    expect(hiloNextX100([king], [], king)).toEqual({ higher: 1287, lower: null });
    expect(hiloMultiplierX100([king, 0], ["higher"])).toBe(1287);
    expect(hiloMultiplierX100([6, 6], ["skip"])).toBe(99);
    expect(hiloWins(6, 6 + 13, "higher")).toBe(true); // same rank counts
    expect(hiloWins(6, 5, "higher")).toBe(false);
  });

  it("returns 99% on any single guess", async () => {
    const { hiloWinningRanks, hiloMultiplierX100 } = await import("../src");
    for (let card = 0; card < 13; card++) {
      for (const c of ["higher", "lower"] as const) {
        const k = hiloWinningRanks(card, c);
        const ev = (k / 13) * (hiloMultiplierX100([card, 0], [c]) / 100);
        expect(ev).toBeLessThanOrEqual(0.99 + 1e-9);
        expect(ev).toBeGreaterThan(0.95);
      }
    }
  });
});
