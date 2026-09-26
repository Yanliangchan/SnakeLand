import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  STARTING_BALANCE,
  applyX100,
  minesMultiplierX100,
  minesPositions,
  plinkoMultiplierX100,
  plinkoPath,
  verifyCommit,
} from "@snakeland/shared";
import { minesRounds } from "../src/db/schema";
import { FairSeedService } from "../src/games/fair-seeds";
import { MinesService } from "../src/games/mines/service";
import { PlinkoService } from "../src/games/plinko/service";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const wallet = new WalletService(db);
const seeds = new FairSeedService(db);
const mines = new MinesService(db, wallet, seeds);
const plinko = new PlinkoService(db, wallet, seeds);

/** Test-only peek at the secret layout, to choose safe or mined tiles on purpose. */
async function layout(roundId: string) {
  const [row] = await db.select().from(minesRounds).where(eq(minesRounds.id, roundId));
  const m = new Set(minesPositions(row!.serverSeed, row!.clientSeed, row!.mines));
  const all = Array.from({ length: 25 }, (_, i) => i);
  return { mined: all.filter((t) => m.has(t)), safe: all.filter((t) => !m.has(t)) };
}

describe("Mines", () => {
  it("uses the pre-committed seed and withholds the layout until the round ends", async () => {
    const userId = await createUser(db);
    const { nextCommit } = await mines.state(userId);
    const u = await mines.start(userId, { bet: 100, mines: 3, clientSeed: "abc" });
    expect(u.round.commit).toBe(nextCommit);
    expect(u.nextCommit).not.toBe(nextCommit);
    expect(u.balance).toBe(STARTING_BALANCE - 100);
    expect(u.round.minePositions).toBeNull();
    expect(u.round.reveal).toBeNull();
    expect(JSON.stringify(u)).not.toMatch(/serverSeed/);
    expect(u.round.nextMultiplierX100).toBe(minesMultiplierX100(3, 1));
  });

  it("pays floor(bet × multiplier) on cash-out and reveals a verifiable layout", async () => {
    const userId = await createUser(db);
    let u = await mines.start(userId, { bet: 150, mines: 5, clientSeed: "cash" });
    const { safe } = await layout(u.round.id);
    for (const tile of safe.slice(0, 4)) {
      u = await mines.reveal(userId, u.round.id, { tile, version: u.round.version });
      expect(u.round.status).toBe("playing");
    }
    expect(u.round.multiplierX100).toBe(minesMultiplierX100(5, 4));
    u = await mines.cashOut(userId, u.round.id, { version: u.round.version });
    const payout = applyX100(150, minesMultiplierX100(5, 4));
    expect(u.round.status).toBe("cashed_out");
    expect(u.round.payout).toBe(payout);
    expect(u.balance).toBe(STARTING_BALANCE - 150 + payout);
    expect(await wallet.ledgerSum(userId)).toBe(u.balance);

    const r = u.round.reveal!;
    expect(verifyCommit(r.serverSeed, r.commit)).toBe(true);
    expect(minesPositions(r.serverSeed, r.clientSeed, 5)).toEqual(u.round.minePositions);
  });

  it("busts on a mine with no payout", async () => {
    const userId = await createUser(db);
    let u = await mines.start(userId, { bet: 100, mines: 10, clientSeed: "boom" });
    const { mined, safe } = await layout(u.round.id);
    u = await mines.reveal(userId, u.round.id, { tile: safe[0]!, version: u.round.version });
    u = await mines.reveal(userId, u.round.id, { tile: mined[0]!, version: u.round.version });
    expect(u.round.status).toBe("bust");
    expect(u.round.bustTile).toBe(mined[0]);
    expect(u.round.payout).toBe(0);
    expect(u.round.minePositions).toEqual(mined);
    expect((await wallet.getWallet(userId)).balance).toBe(STARTING_BALANCE - 100);
    await expect(mines.cashOut(userId, u.round.id, { version: u.round.version })).rejects.toMatchObject({
      code: "ROUND_SETTLED",
    });
  });

  it("auto cashes out once every safe tile is found", async () => {
    const userId = await createUser(db);
    let u = await mines.start(userId, { bet: 10, mines: 24, clientSeed: "one" });
    const { safe } = await layout(u.round.id);
    u = await mines.reveal(userId, u.round.id, { tile: safe[0]!, version: u.round.version });
    expect(u.round.status).toBe("cashed_out");
    expect(u.round.payout).toBe(applyX100(10, 2475));
  });

  it("guards against misuse", async () => {
    const userId = await createUser(db);
    const u = await mines.start(userId, { bet: 10, mines: 3, clientSeed: "guard" });
    const { safe } = await layout(u.round.id);
    await expect(mines.start(userId, { bet: 10, mines: 3, clientSeed: "again" })).rejects.toMatchObject({
      code: "ROUND_IN_PROGRESS",
    });
    await expect(mines.cashOut(userId, u.round.id, { version: u.round.version })).rejects.toMatchObject({
      code: "NOTHING_TO_CASH_OUT",
    });
    await expect(mines.reveal(userId, u.round.id, { tile: 25, version: u.round.version })).rejects.toMatchObject({
      code: "INVALID_TILE",
    });
    const other = await createUser(db);
    await expect(mines.reveal(other, u.round.id, { tile: safe[0]!, version: u.round.version })).rejects.toMatchObject({
      code: "ROUND_NOT_FOUND",
    });
    const v = await mines.reveal(userId, u.round.id, { tile: safe[0]!, version: u.round.version });
    await expect(mines.reveal(userId, u.round.id, { tile: safe[0]!, version: v.round.version })).rejects.toMatchObject({
      code: "TILE_TAKEN",
    });
    await expect(mines.reveal(userId, u.round.id, { tile: safe[1]!, version: u.round.version })).rejects.toMatchObject({
      code: "STALE_VERSION",
    });
    expect((await mines.state(userId)).round?.picks).toEqual([safe[0]]);
  });

  it("applies a double-submitted cash-out once", async () => {
    const userId = await createUser(db);
    let u = await mines.start(userId, { bet: 100, mines: 2, clientSeed: "dbl" });
    const { safe } = await layout(u.round.id);
    u = await mines.reveal(userId, u.round.id, { tile: safe[0]!, version: u.round.version });
    const results = await Promise.allSettled([
      mines.cashOut(userId, u.round.id, { version: u.round.version }),
      mines.cashOut(userId, u.round.id, { version: u.round.version }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await wallet.ledgerSum(userId)).toBe((await wallet.getWallet(userId)).balance);
  });
});

describe("Plinko", () => {
  it("drops along the committed path and pays the table", async () => {
    const userId = await createUser(db);
    const commit = await plinko.nextCommit(userId);
    const res = await plinko.drop(userId, { bet: 100, rows: 12, risk: "medium", clientSeed: "drop" });
    const { drop } = res;
    expect(drop.reveal.commit).toBe(commit);
    expect(res.nextCommit).not.toBe(commit);
    expect(verifyCommit(drop.reveal.serverSeed, commit)).toBe(true);
    expect(plinkoPath(drop.reveal.serverSeed, "drop", 12)).toEqual({ path: drop.path, bucket: drop.bucket });
    expect(drop.multiplierX100).toBe(plinkoMultiplierX100(12, "medium", drop.bucket));
    expect(drop.payout).toBe(applyX100(100, drop.multiplierX100));
    expect(res.balance).toBe(STARTING_BALANCE - 100 + drop.payout);
  });

  it("gives every concurrent drop its own seed and keeps the ledger exact", async () => {
    const userId = await createUser(db);
    await wallet.getWallet(userId);
    const drops = await Promise.all(
      Array.from({ length: 20 }, (_, i) => plinko.drop(userId, { bet: 10, rows: 16, risk: "high", clientSeed: `c${i}` })),
    );
    const commits = new Set(drops.map((d) => d.drop.reveal.commit));
    expect(commits.size).toBe(20);
    const expected = STARTING_BALANCE + drops.reduce((s, d) => s + d.drop.payout - 10, 0);
    expect((await wallet.getWallet(userId)).balance).toBe(expected);
    expect(await wallet.ledgerSum(userId)).toBe(expected);
  });

  it("refuses drops the player can't afford, without consuming a seed", async () => {
    const userId = await createUser(db);
    await wallet.apply({ userId, amount: -(STARTING_BALANCE - 5), type: "bet", game: "mines", roundId: crypto.randomUUID() });
    const before = await plinko.nextCommit(userId);
    await expect(plinko.drop(userId, { bet: 10, rows: 8, risk: "low", clientSeed: "x" })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    expect(await plinko.nextCommit(userId)).toBe(before);
  });
});
