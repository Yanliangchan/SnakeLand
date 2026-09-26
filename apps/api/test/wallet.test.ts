import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { DAILY_CLAIM_AMOUNT, DAILY_CLAIM_COOLDOWN_MS, STARTING_BALANCE } from "@snakeland/shared";
import { transactions } from "../src/db/schema";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const bet = (userId: string, amount: number, extra: Partial<Parameters<WalletService["apply"]>[0]> = {}) => ({
  userId,
  amount: -amount,
  type: "bet" as const,
  game: "blackjack" as const,
  roundId: randomUUID(),
  ...extra,
});

describe("WalletService", () => {
  const wallet = new WalletService(db);

  it("creates a wallet with the starting grant, recorded in the ledger", async () => {
    const userId = await createUser(db);
    const w = await wallet.getWallet(userId);
    expect(w.balance).toBe(STARTING_BALANCE);
    expect(w.nextDailyClaimAt).toBeNull();
    expect(await wallet.ledgerSum(userId)).toBe(STARTING_BALANCE);
  });

  it("debits and credits atomically with balance_after", async () => {
    const userId = await createUser(db);
    const r1 = await wallet.apply(bet(userId, 500));
    expect(r1.balance).toBe(STARTING_BALANCE - 500);
    expect(r1.transaction.balanceAfter).toBe(STARTING_BALANCE - 500);
    const r2 = await wallet.apply({ ...bet(userId, 0), amount: 1000, type: "payout" });
    expect(r2.balance).toBe(STARTING_BALANCE + 500);
    expect(await wallet.ledgerSum(userId)).toBe(r2.balance);
  });

  it("rejects overdrafts and non-integer amounts", async () => {
    const userId = await createUser(db);
    await expect(wallet.apply(bet(userId, STARTING_BALANCE + 1))).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    await expect(wallet.apply(bet(userId, 1.5))).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(wallet.apply(bet(userId, 0))).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect((await wallet.getWallet(userId)).balance).toBe(STARTING_BALANCE);
  });

  it("never overdraws under concurrent bets", async () => {
    const userId = await createUser(db);
    await wallet.getWallet(userId);
    const stake = STARTING_BALANCE / 10;
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => wallet.apply(bet(userId, stake))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect((await wallet.getWallet(userId)).balance).toBe(0);
    expect(await wallet.ledgerSum(userId)).toBe(0);
  });

  it("creates the wallet exactly once under concurrent first access", async () => {
    const userId = await createUser(db);
    await Promise.all(Array.from({ length: 10 }, () => wallet.getWallet(userId)));
    const rows = await db.select().from(transactions).where(eq(transactions.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("is idempotent per key", async () => {
    const userId = await createUser(db);
    const input = bet(userId, 100, { idempotencyKey: "round-1:bet" });
    const [a, b] = await Promise.all([wallet.apply(input), wallet.apply(input)]);
    expect([a.applied, b.applied].sort()).toEqual([false, true]);
    expect(a.transaction.id).toBe(b.transaction.id);
    expect((await wallet.getWallet(userId)).balance).toBe(STARTING_BALANCE - 100);
  });

  it("enforces the daily claim cooldown", async () => {
    let now = new Date("2026-01-01T12:00:00Z");
    const clocked = new WalletService(db, () => now);
    const userId = await createUser(db);

    const first = await clocked.claimDaily(userId);
    expect(first.balance).toBe(STARTING_BALANCE + DAILY_CLAIM_AMOUNT);
    await expect(clocked.claimDaily(userId)).rejects.toMatchObject({ code: "DAILY_CLAIM_NOT_READY" });

    now = new Date(now.getTime() + DAILY_CLAIM_COOLDOWN_MS - 1000);
    await expect(clocked.claimDaily(userId)).rejects.toMatchObject({ code: "DAILY_CLAIM_NOT_READY" });

    now = new Date(now.getTime() + 1000);
    const second = await clocked.claimDaily(userId);
    expect(second.balance).toBe(STARTING_BALANCE + 2 * DAILY_CLAIM_AMOUNT);
  });

  it("allows only one daily claim under concurrency", async () => {
    const userId = await createUser(db);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => wallet.claimDaily(userId)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("carries a guest wallet into a brand-new account", async () => {
    const guestId = await createUser(db, { anonymous: true });
    await wallet.apply(bet(guestId, 123));
    await wallet.claimDaily(guestId);
    const guestBalance = (await wallet.getWallet(guestId)).balance;

    const newId = await createUser(db);
    expect(await wallet.mergeGuestWallet(guestId, newId)).toEqual({ merged: true });

    const merged = await wallet.getWallet(newId);
    expect(merged.balance).toBe(guestBalance);
    expect(merged.nextDailyClaimAt).not.toBeNull(); // cooldown carried over
    expect((await wallet.getWallet(guestId)).balance).toBe(0);
    expect(await wallet.ledgerSum(newId)).toBe(guestBalance);
    expect(await wallet.ledgerSum(guestId)).toBe(0);
  });

  it("does not merge a guest into an existing account (no chip farming)", async () => {
    const existingId = await createUser(db);
    await wallet.getWallet(existingId);
    const guestId = await createUser(db, { anonymous: true });
    await wallet.getWallet(guestId);

    expect(await wallet.mergeGuestWallet(guestId, existingId)).toEqual({ merged: false });
    expect((await wallet.getWallet(existingId)).balance).toBe(STARTING_BALANCE);
  });

  it("paginates transactions newest-first with a stable cursor", async () => {
    const userId = await createUser(db);
    for (let i = 0; i < 7; i++) await wallet.apply(bet(userId, 10));
    const page1 = await wallet.listTransactions(userId, { limit: 5 });
    expect(page1.items).toHaveLength(5);
    const page2 = await wallet.listTransactions(userId, { limit: 5, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(3); // 2 bets + signup bonus
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items].map((t) => t.id);
    expect(new Set(ids).size).toBe(8);
    await expect(wallet.listTransactions(userId, { limit: 5, cursor: "garbage" })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  });

  it("keeps the ledger append-only", async () => {
    const userId = await createUser(db);
    await wallet.getWallet(userId);
    await expect(
      db.update(transactions).set({ amount: 999_999 }).where(eq(transactions.userId, userId)),
    ).rejects.toThrow();
    await expect(db.delete(transactions).where(eq(transactions.userId, userId))).rejects.toThrow();
    await expect(db.execute(sql`truncate transactions`)).rejects.toThrow();
  });
});
