import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DAILY_CLAIM_AMOUNT, weekKey, weekStart } from "@snakeland/shared";
import { hashAdminPassword } from "../src/admin/auth";
import { buildApp } from "../src/app";
import { minesRounds, plinkoDrops, transactions, users, wallets } from "../src/db/schema";
import { loadEnv } from "../src/env";
import { FairSeedService } from "../src/games/fair-seeds";
import { MinesService } from "../src/games/mines/service";
import { PlinkoService } from "../src/games/plinko/service";
import { PurgeService } from "../src/maintenance/purge";
import { ProgressService } from "../src/progress/service";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const ORIGIN = "http://localhost:3000";
const DAY = 86_400_000;
const created: string[] = [];

afterAll(async () => {
  // Keep this run's huge profits off later runs' leaderboards.
  if (created.length) await db.update(users).set({ suspendedAt: new Date() }).where(inArray(users.id, created));
  await pool.end();
});

describe("Leaderboards, titles and perks", () => {
  // A random future week that only this run's players have played in.
  const week = weekKey(new Date()) + 5_000 + Math.floor(Math.random() * 5_000);
  const now = new Date(weekStart(week).getTime() + 2 * DAY + 12 * 3_600_000);
  const clock = () => now;
  const wallet = new WalletService(db, clock);
  const progress = new ProgressService(db, wallet, clock);
  const big = Math.floor(Date.now() / 100);
  let a: string, b: string, c: string, loser: string, guest: string;

  beforeAll(async () => {
    [a, b, c, loser, guest] = await Promise.all([
      createUser(db),
      createUser(db),
      createUser(db),
      createUser(db),
      createUser(db, { anonymous: true }),
    ]);
    created.push(a, b, c, loser, guest);
    const play = (userId: string, amount: number) =>
      wallet.apply({
        userId,
        amount,
        type: amount > 0 ? "payout" : "bet",
        game: "plinko",
        tableId: crypto.randomUUID(),
        roundId: crypto.randomUUID(),
      });
    await play(a, big * 3);
    await play(b, big * 2);
    await play(c, big);
    await play(loser, -900);
    await play(guest, big * 4);
    await db.update(users).set({ name: "Alpha" }).where(eq(users.id, a));
  });

  it("colours the all-time top 3 gold, silver and bronze", async () => {
    const board = await progress.leaderboard("alltime", a);
    expect(board.entries.slice(0, 3).map((e) => e.nameColour)).toEqual(["gold", "silver", "bronze"]);
    expect(board.entries[0]).toMatchObject({ name: "Alpha", isMe: true, hallOfFame: true, profit: big * 3 });
    expect(board.me).toEqual({ rank: 1, profit: big * 3 });
    expect(board.lastPlace).toBeNull();
    expect(board.entries.some((e) => e.profit === big * 4)).toBe(false); // guests never rank
  });

  it("titles the weekly top 3 and the week's biggest loser", async () => {
    const weekly = await progress.leaderboard("weekly", loser);
    expect(weekly.entries.map((e) => e.profit)).toEqual([big * 3, big * 2, big]);
    expect(weekly.entries.map((e) => e.title)).toEqual(["Snake King", "Black Mamba", "Viper"]);
    expect(weekly.lastPlace).toMatchObject({ title: "Safety Stores", profit: -900, isMe: true });
    expect(weekly.weekStartsAt).toBe(weekStart(week).toISOString());
    expect((await progress.profile(loser)).user.title).toBe("Safety Stores");
  });

  it("gives the all-time top 3 bigger daily claims, and #1 a 12h cooldown", async () => {
    const first = await progress.claimDaily(a, false);
    expect(first.amount).toBe(DAILY_CLAIM_AMOUNT * 1.2);
    expect(first.reasons).toEqual(["All-time #1: +20%, every 12h"]);
    expect(first.nextDailyClaimAt).toBe(new Date(now.getTime() + 12 * 3_600_000).toISOString());
    expect((await progress.claimDaily(b, false)).amount).toBe(DAILY_CLAIM_AMOUNT * 1.1);
    const third = await progress.claimDaily(c, false);
    expect(third.amount).toBe(DAILY_CLAIM_AMOUNT * 1.05);
    expect(third.nextDailyClaimAt).toBe(new Date(now.getTime() + DAY).toISOString());
    expect((await progress.claimDaily(guest, true)).amount).toBe(DAILY_CLAIM_AMOUNT);
    await expect(progress.claimDaily(a, false)).rejects.toMatchObject({ code: "DAILY_CLAIM_NOT_READY" });

    const profile = await progress.profile(a);
    expect(profile.user).toMatchObject({ title: "Snake King", nameColour: "gold", isGuest: false });
    expect(profile.stats.allTimeRank).toBe(1);
    expect(profile.stats.biggestWin).toBe(big * 3);
  });
});

describe("Purge", () => {
  const wallet = new WalletService(db);
  const seeds = new FairSeedService(db);
  const mines = new MinesService(db, wallet, seeds);
  const plinko = new PlinkoService(db, wallet, seeds);
  const purge = new PurgeService(db);

  it("removes a guest and everything it owns, but never a registered player", async () => {
    const guest = await createUser(db, { anonymous: true });
    await plinko.drop(guest, { bet: 10, rows: 8, risk: "low", clientSeed: "guest-seed" });
    await mines.start(guest, { bet: 10, mines: 3, clientSeed: "guest-seed" });
    expect(await purge.purgeGuest(guest)).toBe(true);
    expect(await db.select().from(users).where(eq(users.id, guest))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, guest))).toHaveLength(0);

    const player = await createUser(db);
    created.push(player);
    await wallet.getWallet(player);
    expect(await purge.purgeGuest(player)).toBe(false);
    expect(await db.select().from(wallets).where(eq(wallets.userId, player))).toHaveLength(1);
  });

  it("keeps the ledger append-only outside a purge", async () => {
    const player = await createUser(db);
    created.push(player);
    await wallet.getWallet(player);
    await expect(db.delete(transactions).where(eq(transactions.userId, player))).rejects.toThrow();
  });

  it("drops finished game rows after a week but keeps money and live rounds", async () => {
    const player = await createUser(db);
    created.push(player);
    await plinko.drop(player, { bet: 10, rows: 8, risk: "low", clientSeed: "player-seed" });
    const live = await mines.start(player, { bet: 10, mines: 3, clientSeed: "player-seed" });

    const report = await purge.purgeOldGameData(new Date(Date.now() + 8 * DAY));
    expect(report.plinko_drops).toBeGreaterThan(0);
    expect(await db.select().from(plinkoDrops).where(eq(plinkoDrops.userId, player))).toHaveLength(0);
    expect(await db.select().from(minesRounds).where(eq(minesRounds.id, live.round.id))).toHaveLength(1);
    expect(await wallet.ledgerSum(player)).toBe((await wallet.getWallet(player)).balance);
  });

  it("closes guests that have been gone for a week", async () => {
    const guest = await createUser(db, { anonymous: true });
    expect(await purge.purgeInactiveGuests(new Date(Date.now() + 8 * DAY))).toBeGreaterThan(0);
    expect(await db.select().from(users).where(eq(users.id, guest))).toHaveLength(0);
  });
});

function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

describe("Admin console + account routes", () => {
  const PASSWORD = "admin-test-password";
  let app: FastifyInstance;
  let admin: string;
  const post = (url: string, payload?: unknown, cookie = admin) =>
    app.inject({
      method: "POST",
      url,
      headers: { origin: ORIGIN, cookie, ...(payload ? { "content-type": "application/json" } : {}) },
      payload: payload ? JSON.stringify(payload) : undefined,
    });
  const get = (url: string, cookie = admin) => app.inject({ method: "GET", url, headers: { cookie } });

  async function signUp(name: string) {
    const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const res = await post("/api/auth/sign-up/email", { email, password: "correct horse battery", name }, "");
    const cookie = cookieFrom(res);
    const me = (await get("/v1/me", cookie)).json();
    created.push(me.user.id);
    return { email, cookie, id: me.user.id as string };
  }

  beforeAll(async () => {
    const env = loadEnv({ ...process.env, ADMIN_PASSWORD_HASH: await hashAdminPassword(PASSWORD) });
    ({ app } = await buildApp({ env, db, redis: null }));
  });
  afterAll(() => app.close());

  it("requires the password and sets a strict, path-scoped cookie", async () => {
    expect((await get("/v1/admin/players", "")).statusCode).toBe(401);
    expect((await post("/v1/admin/login", { password: "nope" }, "")).statusCode).toBe(401);
    const noOrigin = await app.inject({
      method: "POST",
      url: "/v1/admin/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ password: PASSWORD }),
    });
    expect(noOrigin.statusCode).toBe(403);

    const ok = await post("/v1/admin/login", { password: PASSWORD }, "");
    expect(ok.statusCode).toBe(200);
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/v1\/admin/);
    admin = cookieFrom(ok);
    expect((await get("/v1/admin/stats")).json().players).toBeGreaterThan(0);
  });

  it("finds players and adjusts or sets their balance through the ledger", async () => {
    const p = await signUp("Adminable");
    const list = (await get(`/v1/admin/players?q=${encodeURIComponent(p.email)}`)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: p.id, name: "Adminable", balance: 1_000, isGuest: false });

    expect((await post(`/v1/admin/players/${p.id}/balance`, { mode: "adjust", amount: 500 })).json().balance).toBe(1_500);
    expect((await post(`/v1/admin/players/${p.id}/balance`, { mode: "set", amount: 42 })).json().balance).toBe(42);
    expect((await post(`/v1/admin/players/${p.id}/balance`, { mode: "set", amount: 42 })).statusCode).toBe(400);
    expect((await post(`/v1/admin/players/${p.id}/balance`, { mode: "adjust", amount: -100 })).statusCode).toBe(409);
    expect((await get("/v1/me", p.cookie)).json().wallet.balance).toBe(42);
    const w = new WalletService(db);
    expect(await w.ledgerSum(p.id)).toBe(42);

    expect((await post(`/v1/admin/players/${p.id}/rename`, { name: "  Renamed  " })).json().name).toBe("Renamed");
    const detail = (await get(`/v1/admin/players/${p.id}`)).json();
    expect(detail.profile.user.name).toBe("Renamed");
    expect(detail.profile.stats.allTimeProfit).toBe(0); // admin money isn't profit
    expect(detail.audit.map((a: { action: string }) => a.action)).toEqual(["rename", "balance", "balance"]);
    expect((await get("/v1/admin/players/nope")).statusCode).toBe(404);
  });

  it("resets the daily claim and reports perk-aware claims", async () => {
    const p = await signUp("Claimer");
    const first = (await post("/v1/wallet/daily-claim", undefined, p.cookie)).json();
    expect(first.amount).toBe(DAILY_CLAIM_AMOUNT);
    expect((await post("/v1/wallet/daily-claim", undefined, p.cookie)).statusCode).toBe(409);
    await post(`/v1/admin/players/${p.id}/reset-claim`);
    expect((await post("/v1/wallet/daily-claim", undefined, p.cookie)).statusCode).toBe(200);
  });

  it("suspends a player: signed out now and unable to sign back in", async () => {
    const p = await signUp("Suspect");
    await post(`/v1/admin/players/${p.id}/suspend`, { suspended: true });
    expect((await get("/v1/me", p.cookie)).statusCode).toBe(401);
    const signIn = () => post("/api/auth/sign-in/email", { email: p.email, password: "correct horse battery" }, "");
    expect((await signIn()).statusCode).toBe(403);
    await post(`/v1/admin/players/${p.id}/suspend`, { suspended: false });
    expect((await signIn()).statusCode).toBe(200);
    expect((await post(`/v1/admin/players/${p.id}/delete-guest`)).statusCode).toBe(409);
  });

  it("lets a guest leave, deleting the guest completely", async () => {
    const guest = await post("/api/auth/sign-in/anonymous", undefined, "");
    const cookie = cookieFrom(guest);
    const id = (await get("/v1/me", cookie)).json().user.id as string;
    expect((await post("/v1/account/leave-guest", undefined, cookie)).statusCode).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
    expect((await get("/v1/me", cookie)).statusCode).toBe(401);

    const p = await signUp("Stayer");
    expect((await post("/v1/account/leave-guest", undefined, p.cookie)).statusCode).toBe(409);
  });

  it("signs the admin out", async () => {
    const out = await post("/v1/admin/logout");
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    expect((await get("/v1/admin/stats")).statusCode).toBe(401);
  });

  it("locks logins after repeated failures, even for the right password", async () => {
    const env = loadEnv({ ...process.env, ADMIN_PASSWORD_HASH: await hashAdminPassword(PASSWORD) });
    const other = (await buildApp({ env, db, redis: null })).app;
    const login = (password: string) =>
      other.inject({
        method: "POST",
        url: "/v1/admin/login",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        payload: JSON.stringify({ password }),
      });
    for (let i = 0; i < 5; i++) expect((await login("wrong")).statusCode).toBe(401);
    const locked = await login(PASSWORD);
    expect(locked.statusCode).toBe(429);
    await other.close();
  });

  it("is switched off without a configured password", async () => {
    const off = (await buildApp({ env: loadEnv(), db, redis: null })).app;
    const res = await off.inject({
      method: "POST",
      url: "/v1/admin/login",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.statusCode).toBe(404);
    await off.close();
  });
});

