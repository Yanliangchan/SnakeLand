import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  BACCARAT_BETS,
  STARTING_BALANCE,
  baccaratReturn,
  orderedShoe,
  shuffleShoe,
  verifyCommit,
  type BaccaratUpdateDTO,
} from "@snakeland/shared";
import { baccaratRounds } from "../src/db/schema";
import { BaccaratService } from "../src/games/baccarat/service";
import type { BaccaratHand } from "../src/games/baccarat/engine";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());
const wallet = new WalletService(db);
const baccarat = new BaccaratService(db, wallet);

describe("BaccaratService", () => {
  it("settles a coup in one request with exact payouts", async () => {
    const userId = await createUser(db);
    const table = await baccarat.getTable(userId);
    const bets = { banker: 100, tie: 20, playerPair: 10 };
    const u = await baccarat.play(userId, { tableId: table.id, bets, clientSeed: "mine" });
    const expected = BACCARAT_BETS.reduce((s, b) => s + baccaratReturn(b, bets[b as keyof typeof bets] ?? 0, u.round), 0);
    expect(u.round.totalBet).toBe(130);
    expect(u.round.totalPayout).toBe(expected);
    expect(u.balance).toBe(STARTING_BALANCE - 130 + expected);
    expect(u.table.road[0]).toBe(u.round.winner);
    expect(u.table.shoe.clientSeed).toBe("mine");
    expect(await wallet.ledgerSum(userId)).toBe(u.balance);
  });

  it("validates bet slips", async () => {
    const userId = await createUser(db);
    const table = await baccarat.getTable(userId);
    await expect(baccarat.play(userId, { tableId: table.id, bets: {} })).rejects.toMatchObject({ code: "NO_BETS" });
    await expect(baccarat.play(userId, { tableId: table.id, bets: { player: 5 } })).rejects.toMatchObject({
      code: "BET_OUT_OF_RANGE",
    });
    await expect(
      baccarat.play(userId, { tableId: table.id, bets: { player: 60_000, banker: 40_001 } }),
    ).rejects.toMatchObject({ code: "BET_OUT_OF_RANGE" });
    const other = await createUser(db);
    await expect(baccarat.play(other, { tableId: table.id, bets: { player: 10 } })).rejects.toMatchObject({
      code: "TABLE_NOT_FOUND",
    });
  });

  it("plays out a shoe that replays exactly from its revealed seeds", async () => {
    const userId = await createUser(db);
    const table = await baccarat.getTable(userId);
    const commit = table.shoe.commit;
    let u: BaccaratUpdateDTO | null = null;
    let rounds = 0;
    while (!u?.revealedShoe) {
      u = await baccarat.play(userId, { tableId: table.id, bets: { player: 10 } });
      expect(++rounds).toBeLessThan(120);
    }
    const shoe = u.revealedShoe;
    expect(verifyCommit(shoe.serverSeed, commit)).toBe(true);
    const cards = shuffleShoe(orderedShoe(8), shoe.serverSeed, shoe.clientSeed!);
    const rows = await db.select().from(baccaratRounds).where(eq(baccaratRounds.shoeId, shoe.id));
    expect(rows).toHaveLength(rounds);
    for (const row of rows) {
      const hand = row.hand as BaccaratHand;
      for (const c of [...hand.player, ...hand.banker]) expect(c.code).toBe(cards[row.shoeStart + c.seq]);
    }
    expect(u.table.shoe.id).not.toBe(shoe.id);
    expect(await wallet.ledgerSum(userId)).toBe((await wallet.getWallet(userId)).balance);
  });

  it("next table reveals the shoe and resets the road", async () => {
    const userId = await createUser(db);
    const table = await baccarat.getTable(userId);
    await baccarat.play(userId, { tableId: table.id, bets: { banker: 10 } });
    const next = await baccarat.nextTable(userId);
    expect(next.table.id).not.toBe(table.id);
    expect(next.table.road).toEqual([]);
    expect(verifyCommit(next.revealedShoe!.serverSeed, table.shoe.commit)).toBe(true);
  });
});
