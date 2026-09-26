import { describe, expect, it } from "vitest";
import {
  MINES_SIZES,
  minesTiles,
  PLINKO_RISKS,
  PLINKO_ROWS_MAX,
  PLINKO_ROWS_MIN,
  PLINKO_TABLES,
  applyX100,
  minesMultiplierX100,
  minesPositions,
  plinkoPath,
} from "../src/instant";

const binom = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};
const SEED = "c".repeat(64);

describe("plinko tables", () => {
  for (const risk of PLINKO_RISKS) {
    for (let rows = PLINKO_ROWS_MIN; rows <= PLINKO_ROWS_MAX; rows++) {
      it(`${risk} ${rows} rows returns 98.5–99% and is symmetric`, () => {
        const table = PLINKO_TABLES[risk][rows]!;
        expect(table).toHaveLength(rows + 1);
        expect([...table].reverse()).toEqual(table);
        for (const x of table) expect(Number.isInteger(x) && x > 0).toBe(true);
        const rtp = table.reduce((s, x, k) => s + (binom(rows, k) / 2 ** rows) * (x / 100), 0);
        expect(rtp).toBeGreaterThanOrEqual(0.985);
        expect(rtp).toBeLessThanOrEqual(0.99);
        // Payouts never shrink moving out from the centre.
        for (let k = 0; k < rows / 2; k++) expect(table[k]!).toBeGreaterThanOrEqual(table[k + 1]!);
      });
    }
  }
});

describe("plinko path", () => {
  it("is deterministic and lands where the path says", () => {
    const a = plinkoPath(SEED, "client", 16);
    expect(plinkoPath(SEED, "client", 16)).toEqual(a);
    expect(a.path).toHaveLength(16);
    expect(a.bucket).toBe(a.path.filter((b) => b === 1).length);
  });

  it("is binomially distributed", () => {
    const rows = 8;
    const counts = new Array(rows + 1).fill(0);
    const N = 20_000;
    for (let i = 0; i < N; i++) counts[plinkoPath(SEED, `c${i}`, rows).bucket]++;
    for (let k = 0; k <= rows; k++) {
      const expected = (binom(rows, k) / 2 ** rows) * N;
      expect(Math.abs(counts[k] - expected)).toBeLessThan(5 * Math.sqrt(expected) + 5);
    }
  });

  it("rejects bad row counts", () => {
    expect(() => plinkoPath(SEED, "c", 7)).toThrow();
    expect(() => plinkoPath(SEED, "c", 17)).toThrow();
  });
});

describe("mines", () => {
  it("prices the first pick at fair odds minus 3%", () => {
    expect(minesMultiplierX100(25, 1, 0)).toBe(100);
    expect(minesMultiplierX100(25, 1, 1)).toBe(101); // 25/24 * 0.97 = 1.0104
    expect(minesMultiplierX100(25, 3, 1)).toBe(110); // 25/22 * 0.97 = 1.1022
    expect(minesMultiplierX100(25, 24, 1)).toBe(2425); // 25 * 0.97
    expect(minesMultiplierX100(9, 8, 1)).toBe(873); // 9 * 0.97
    expect(() => minesMultiplierX100(25, 25, 1)).toThrow();
    expect(() => minesMultiplierX100(10, 1, 1)).toThrow(); // not a square board
  });

  it("returns at most 97% in expectation on every board, mine count and pick count", () => {
    for (const size of MINES_SIZES) {
      const tiles = minesTiles(size);
      for (let m = 1; m < tiles; m++) {
        let prev = 0;
        for (let k = 1; k <= tiles - m; k++) {
          const x = minesMultiplierX100(tiles, m, k);
          expect(x).toBeGreaterThanOrEqual(prev);
          prev = x;
          const survive = binom(tiles - m, k) / binom(tiles, k);
          const ev = (survive * x) / 100;
          expect(ev).toBeLessThanOrEqual(0.97 + 1e-9);
        }
      }
    }
  });

  it("places exactly N distinct mines on any board, deterministically", () => {
    for (const size of MINES_SIZES) {
      const tiles = minesTiles(size);
      for (const m of [1, Math.floor(tiles / 2), tiles - 1]) {
        const pos = minesPositions(SEED, "client", tiles, m);
        expect(pos).toHaveLength(m);
        expect(new Set(pos).size).toBe(m);
        expect(pos.every((p) => p >= 0 && p < tiles)).toBe(true);
        expect(minesPositions(SEED, "client", tiles, m)).toEqual(pos);
      }
    }
  });

  it("puts a single mine on every tile uniformly", () => {
    const counts = new Array(25).fill(0);
    for (let i = 0; i < 25_000; i++) counts[minesPositions(SEED, `u${i}`, 25, 1)[0]!]++;
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(160);
  });
});

describe("applyX100", () => {
  it("floors exactly, even for huge multipliers", () => {
    expect(applyX100(100, 103)).toBe(103);
    expect(applyX100(15, 150)).toBe(22);
    expect(minesMultiplierX100(64, 32, 32)).toBe(100_000_000); // capped at 1,000,000×
    expect(applyX100(10_000, minesMultiplierX100(64, 32, 32))).toBe(10_000_000_000);
    expect(() => applyX100(1.5, 100)).toThrow();
  });
});
