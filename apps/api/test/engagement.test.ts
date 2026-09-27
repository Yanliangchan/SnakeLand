import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { REFERRAL_REWARD, SPIN_COOLDOWN_HOURS, STARTING_BALANCE, spinMultiplier } from "@snakeland/shared";
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
