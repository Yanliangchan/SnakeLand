import { describe, expect, it } from "vitest";
import {
  MINES_MAX,
  MINES_MIN,
  MINES_TILES,
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
  it("prices the first pick at fair odds minus 1%", () => {
    expect(minesMultiplierX100(1, 0)).toBe(100);
    expect(minesMultiplierX100(1, 1)).toBe(103); // 25/24 * 0.99 = 1.03125
    expect(minesMultiplierX100(3, 1)).toBe(112); // 25/22 * 0.99 = 1.125
    expect(minesMultiplierX100(24, 1)).toBe(2475); // 25 * 0.99
  });

  it("never pays more than 99% in expectation, for every mines/picks combination", () => {
    for (let m = MINES_MIN; m <= MINES_MAX; m++) {
      let prev = 0;
      for (let k = 1; k <= MINES_TILES - m; k++) {
        const x = minesMultiplierX100(m, k);
        expect(x).toBeGreaterThan(prev);
        prev = x;
        const survive = binom(MINES_TILES - m, k) / binom(MINES_TILES, k);
        const ev = (survive * x) / 100;
        expect(ev).toBeLessThanOrEqual(0.99 + 1e-9);
        expect(ev).toBeGreaterThan(0.95);
      }
    }
  });

  it("places exactly N distinct mines, deterministically", () => {
    for (const m of [1, 5, 24]) {
      const pos = minesPositions(SEED, "client", m);
      expect(pos).toHaveLength(m);
      expect(new Set(pos).size).toBe(m);
      expect(pos.every((p) => p >= 0 && p < 25)).toBe(true);
      expect(minesPositions(SEED, "client", m)).toEqual(pos);
    }
  });

  it("puts a single mine on every tile uniformly", () => {
    const counts = new Array(25).fill(0);
    for (let i = 0; i < 25_000; i++) counts[minesPositions(SEED, `u${i}`, 1)[0]!]++;
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(160);
  });
});

describe("applyX100", () => {
  it("floors exactly, even for huge multipliers", () => {
    expect(applyX100(100, 103)).toBe(103);
    expect(applyX100(15, 150)).toBe(22);
    expect(applyX100(5000, minesMultiplierX100(12, 13))).toBeGreaterThan(0);
    expect(() => applyX100(1.5, 100)).toThrow();
  });
});
