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
  it("returns at most 97% in every mode, and close to it", () => {
    for (const mode of CARRIER_MODES) {
      const rtp = carrierExactRtp(mode);
      expect(rtp).toBeLessThanOrEqual(0.97);
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

  it("pays 97% ÷ survival odds", () => {
    expect(ladderMultiplierX100("tower", "hard", 1)).toBe(194);
    expect(ladderMultiplierX100("tower", "easy", 2)).toBe(172); // 97 × 16/9
    expect(ladderMultiplierX100("tower", "expert", 8)).toBe(636_417);
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

  it("pays 97% ÷ survival odds", () => {
    expect(ladderMultiplierX100("crossing", "daredevil", 1)).toBe(161); // 97 × 5/3
    expect(ladderMultiplierX100("crossing", "easy", 1)).toBe(101);
  });
});
