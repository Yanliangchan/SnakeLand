import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CASHBACK_PERCENT,
  REFERRAL_REWARD,
  RESCUE_AMOUNT,
  RESCUE_COOLDOWN_HOURS,
  SPIN_COOLDOWN_HOURS,
  STARTING_BALANCE,
  spinMultiplier,
} from "@snakeland/shared";
import { users } from "../src/db/schema";
import { ChatService, MemoryChatStore } from "../src/chat/service";
import { EngagementService } from "../src/engagement/service";
import { MemoryBus } from "../src/realtime/bus";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const person = (id: string, name = "P", anonymous = false) => ({ id, name, email: `${id}@x.test`, isAnonymous: anonymous });

describe("daily bonus spin", () => {
  it("spins once per cooldown, credits, and advances the streak", async () => {
    // A wallet clock we can advance.
    let now = new Date("2026-01-01T00:00:00Z");
    const wallet = new WalletService(db, () => now);
    const id = await createUser(db);
    const s0 = await wallet.spinState(id);
    expect(s0.canSpin).toBe(true);
    expect(s0.streak).toBe(1);
    const r1 = await wallet.spinBonus(id);
    expect(r1.amount).toBeGreaterThan(0);
    expect(r1.streak).toBe(1);
    expect(r1.balance).toBe(STARTING_BALANCE + r1.amount);
    // Immediately: not ready.
    await expect(wallet.spinBonus(id)).rejects.toMatchObject({ code: "SPIN_NOT_READY" });
    expect((await wallet.spinState(id)).canSpin).toBe(false);

    // A day later: streak 2, bigger wheel.
    now = new Date(now.getTime() + SPIN_COOLDOWN_HOURS * 3_600_000 + 1000);
    const r2 = await wallet.spinBonus(id);
    expect(r2.streak).toBe(2);
    expect(r2.segments[0]).toBe(Math.floor(200 * spinMultiplier(2)));

    // Skip several days: streak resets to 1.
    now = new Date(now.getTime() + 3 * SPIN_COOLDOWN_HOURS * 3_600_000);
    const r3 = await wallet.spinBonus(id);
    expect(r3.streak).toBe(1);
    expect(await wallet.ledgerSum(id)).toBe((await wallet.getWallet(id)).balance);
  });
});

describe("referrals", () => {
  it("pays both sides once, guards self/expiry/double", async () => {
    const wallet = new WalletService(db);
    const eng = new EngagementService(db, wallet, new ChatService(db, new MemoryChatStore(), new MemoryBus()));
    const refId = await createUser(db);
    const newId = await createUser(db);
    const newUser = person(newId);

    await expect(eng.redeemReferral(newUser, newId)).rejects.toMatchObject({ code: "SELF_REFERRAL" });
    const r = await eng.redeemReferral(newUser, refId);
    expect(r).toEqual({ ok: true, reward: REFERRAL_REWARD });
    expect((await wallet.getWallet(newId)).balance).toBe(STARTING_BALANCE + REFERRAL_REWARD);
    expect((await wallet.getWallet(refId)).balance).toBe(STARTING_BALANCE + REFERRAL_REWARD);
    // Can't redeem twice.
    expect(await eng.redeemReferral(newUser, refId)).toEqual({ ok: false, reward: 0 });

    const state = await eng.referralState(refId);
    expect(state).toMatchObject({ code: refId, referred: 1, earned: REFERRAL_REWARD });

    // Too old to be referred.
    const oldId = await createUser(db);
    await db.update(users).set({ createdAt: new Date(Date.now() - 2 * 24 * 3_600_000) }).where(eq(users.id, oldId));
    await expect(eng.redeemReferral(person(oldId), refId)).rejects.toMatchObject({ code: "REFERRAL_EXPIRED" });
  });
});

describe("tips and rain", () => {
  it("transfers a tip and posts a system line", async () => {
    const wallet = new WalletService(db);
    const chat = new ChatService(db, new MemoryChatStore(), new MemoryBus());
    const eng = new EngagementService(db, wallet, chat);
    const a = await createUser(db, {});
    const b = await createUser(db, {});
    await wallet.apply({ userId: a, amount: 100, type: "signup_bonus" }); // create wallet at 1000+100
    await eng.tip(person(a, "Ana"), "crash", b, 300);
    expect((await wallet.getWallet(a)).balance).toBe(STARTING_BALANCE + 100 - 300);
    expect((await wallet.getWallet(b)).balance).toBe(STARTING_BALANCE + 300);
    const hist = await chat.history(person(a, "Ana"), "crash");
    expect(hist.messages.at(-1)).toMatchObject({ kind: "system" });
    expect(hist.messages.at(-1)!.text).toContain("tipped");
    await expect(eng.tip(person(a), "crash", a, 10)).rejects.toMatchObject({ code: "SELF_TIP" });
  });

  it("rain splits among recent chatters", async () => {
    const wallet = new WalletService(db);
    const chat = new ChatService(db, new MemoryChatStore(), new MemoryBus());
    const eng = new EngagementService(db, wallet, chat);
    const ids = await Promise.all([createUser(db), createUser(db), createUser(db)]);
    for (const id of ids) await chat.post(person(id, "U" + id.slice(0, 4)), "crash", "hi there");
    const res = await eng.rain("crash", 900);
    expect(res.recipients).toBe(3);
    expect(res.each).toBe(300);
    for (const id of ids) expect((await wallet.getWallet(id)).balance).toBe(STARTING_BALANCE + 300);
    await expect(eng.rain("roulette:w1", 900)).rejects.toMatchObject({ code: "NO_ONE_HERE" });
  });
});

describe("announcements", () => {
  it("keeps only one active, and reads the active one", async () => {
    const wallet = new WalletService(db);
    const eng = new EngagementService(db, wallet, new ChatService(db, new MemoryChatStore(), new MemoryBus()));
    const a = await eng.createAnnouncement({ body: "First", level: "info", href: null, active: true });
    const b = await eng.createAnnouncement({ body: "Second", level: "success", href: "/lab", active: true });
    const active = await eng.active();
    expect(active).toMatchObject({ id: b, body: "Second", level: "success", href: "/lab" });
    const list = await eng.adminList();
    expect(list.find((x) => x.id === a)!.active).toBe(false);
    await eng.removeAnnouncement(b);
    expect(await eng.active()).toBeNull();
  });
});

describe("cashback and rescue", () => {
  const bet = (w: WalletService, userId: string, amount: number) =>
    w.apply({ userId, amount: -amount, type: "bet", game: "mines", roundId: crypto.randomUUID() });
  const pay = (w: WalletService, userId: string, amount: number) =>
    w.apply({ userId, amount, type: "payout", game: "mines", roundId: crypto.randomUUID() });

  it("pays 50% of today's net losses, only once per loss, with no daily cap", async () => {
    // Ledger rows are stamped with the real time, so the clock starts at now.
    let now = new Date();
    const w = new WalletService(db, () => now);
    const id = await createUser(db);
    await w.apply({ userId: id, amount: 200_000, type: "admin_adjust" });
    expect((await w.rewardsState(id)).cashback.available).toBe(0);
    await expect(w.claimCashback(id)).rejects.toMatchObject({ code: "NOTHING_TO_CLAIM" });

    // Lose 1,000 net (bet 1,500, win back 500): 500 back.
    await bet(w, id, 1_500);
    await pay(w, id, 500);
    const s = await w.rewardsState(id);
    expect(s.cashback.lossToday).toBe(1_000);
    expect(s.cashback.available).toBe(CASHBACK_PERCENT * 10);
    const c = await w.claimCashback(id);
    expect(c.amount).toBe(500);
    // Claiming again pays nothing new; the cashback itself doesn't count as a win.
    await expect(w.claimCashback(id)).rejects.toMatchObject({ code: "NOTHING_TO_CLAIM" });
    // More losses top it up, however large.
    await bet(w, id, 100_000);
    const big = await w.claimCashback(id);
    expect(big.amount).toBe(50_000);
    expect((await w.rewardsState(id)).cashback.available).toBe(0);

    // A new UTC day starts fresh.
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 1, 0);
    now = tomorrow;
    const fresh = await w.rewardsState(id);
    expect(fresh.cashback.lossToday).toBe(0);
    expect(fresh.cashback.claimedToday).toBe(0);
    expect(await w.ledgerSum(id)).toBe((await w.getWallet(id)).balance);
  });

  it("tops up a nearly-broke player once per cooldown", async () => {
    let now = new Date();
    const w = new WalletService(db, () => now);
    const id = await createUser(db);
    await expect(w.claimRescue(id)).rejects.toMatchObject({ code: "RESCUE_NOT_READY" }); // 1,000 isn't broke
    await bet(w, id, STARTING_BALANCE - 50);
    expect((await w.rewardsState(id)).rescue.canClaim).toBe(true);
    const r = await w.claimRescue(id);
    expect(r.balance).toBe(50 + RESCUE_AMOUNT);
    await bet(w, id, r.balance - 10);
    const st = await w.rewardsState(id);
    expect(st.rescue.canClaim).toBe(false);
    expect(st.rescue.nextAt).not.toBeNull();
    await expect(w.claimRescue(id)).rejects.toMatchObject({ code: "RESCUE_NOT_READY" });
    now = new Date(now.getTime() + RESCUE_COOLDOWN_HOURS * 3_600_000 + 1000);
    expect((await w.claimRescue(id)).balance).toBe(10 + RESCUE_AMOUNT);
  });
});
