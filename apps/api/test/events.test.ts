import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  STARTING_BALANCE,
  crashPointX100,
  eventPrizes,
  hashServerSeed,
  hiloCards,
  minesPositions,
  raceRoundSeed,
  RACE_CLIENT_SEED,
  type AdminEventInput,
} from "@snakeland/shared";
import { events, ladderRounds, minesRounds } from "../src/db/schema";
import { EventService, type PlayCtx } from "../src/events/service";
import { LadderService } from "../src/games/arcade/ladder";
import { FairSeedService } from "../src/games/fair-seeds";
import { MinesService } from "../src/games/mines/service";
import { PlinkoService } from "../src/games/plinko/service";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

// A clock the tests move forward to open and close event windows.
let now = new Date();
const clock = () => now;
const wallet = new WalletService(db);
const eventsSvc = new EventService(db, wallet, clock);
const seeds = new FairSeedService(db);
const mines = new MinesService(db, wallet, seeds, eventsSvc);
const plinko = new PlinkoService(db, wallet, seeds, eventsSvc);
const ladder = new LadderService(db, wallet, seeds, eventsSvc);

const person = (id: string, anonymous = false) => ({ id, name: `P-${id.slice(0, 4)}`, email: `${id}@x.test`, isAnonymous: anonymous });

async function makeEvent(over: Partial<AdminEventInput> = {}) {
  now = new Date();
  return eventsSvc.create({
    title: "Test",
    mode: "ffa",
    game: null,
    startsAt: new Date(now.getTime() + 60_000).toISOString(),
    minutes: 30,
    stack: 1000,
    buyIn: 100,
    topUp: 400,
    rounds: null,
    mines: null,
    ...over,
  });
}
const open = () => (now = new Date(Date.now() + 2 * 60_000));
const close = () => (now = new Date(Date.now() + 60 * 60_000));

describe("event prizes", () => {
  it("splits 50/30/20, rescales for fewer players, shares ties", () => {
    expect(eventPrizes([9, 5, 3, 1], 1000)).toEqual([500, 300, 200, 0]);
    expect(eventPrizes([9, 5], 800)).toEqual([500, 300]);
    expect(eventPrizes([9], 800)).toEqual([800]);
    // Two tied for first share 1st+2nd.
    expect(eventPrizes([9, 9, 3], 1000)).toEqual([400, 400, 200]);
    expect(eventPrizes([9, 5, 5, 5], 1000)).toEqual([502, 166, 166, 166]);
  });
});

describe("free-for-all", () => {
  it("plays with the event stack, leaves the wallet alone, and pays the pot on settle", async () => {
    const id = await makeEvent();
    const [a, b, c] = [await createUser(db), await createUser(db), await createUser(db)];
    await expect(eventsSvc.join(person(a, true), id)).rejects.toMatchObject({ code: "SIGN_UP_REQUIRED" });
    for (const u of [a, b, c]) await eventsSvc.join(person(u), id);
    await expect(eventsSvc.join(person(a), id)).rejects.toMatchObject({ code: "ALREADY_JOINED" });
    expect((await wallet.getWallet(a)).balance).toBe(STARTING_BALANCE - 100);

    const ctx = (await eventsSvc.resolve(id, a, "plinko"))!;
    expect(ctx).toEqual<PlayCtx>({ eventId: id, race: false });
    // Not live yet.
    await expect(plinko.drop(a, { bet: 100, rows: 8, risk: "low", clientSeed: "x" }, ctx)).rejects.toMatchObject({ code: "EVENT_CLOSED" });
    await expect(eventsSvc.resolve(id, a, "crash")).rejects.toMatchObject({ code: "EVENT_GAME" });
    const outsider = await createUser(db);
    await expect(eventsSvc.resolve(id, outsider, "plinko")).rejects.toMatchObject({ code: "NOT_IN_EVENT" });

    open();
    const walletBefore = (await wallet.getWallet(a)).balance;
    const d = await plinko.drop(a, { bet: 100, rows: 8, risk: "low", clientSeed: "x" }, ctx);
    expect(d.balance).toBe(1000 - 100 + d.drop.payout);
    expect((await wallet.getWallet(a)).balance).toBe(walletBefore);
    // Can't bet more than the stack.
    await expect(plinko.drop(a, { bet: 10_000, rows: 8, risk: "low", clientSeed: "x" }, ctx)).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });

    // b wagers a full stack in mines (qualifies); c never plays (doesn't).
    const mctx = (await eventsSvc.resolve(id, b, "mines"))!;
    let stack = 1000;
    for (let i = 0; i < 10; i++) {
      const u = await mines.start(b, { bet: 100, mines: 1, clientSeed: "y" }, mctx);
      // Normal (wallet) mines is untouched by the event round.
      expect((await mines.state(b)).round).toBeNull();
      const [row] = await db.select().from(minesRounds).where(eq(minesRounds.id, u.round.id));
      expect(row!.eventId).toBe(id);
      const safe = Array.from({ length: 25 }, (_, t) => t).find((t) => !minesPositions(row!.serverSeed, row!.clientSeed, 25, 1).includes(t))!;
      const r = await mines.reveal(b, u.round.id, { tile: safe, version: u.round.version });
      const c2 = await mines.cashOut(b, u.round.id, { version: r.round.version });
      stack = c2.balance!;
    }
    close();
    const detail = await eventsSvc.detail(id, b);
    expect(detail.status).toBe("ended");
    const byUser = new Map(detail.standings.map((s) => [s.userId, s]));
    expect(byUser.get(b)!.qualified).toBe(true);
    expect(byUser.get(b)!.stack).toBe(stack);
    expect(byUser.get(c)!.qualified).toBe(false);
    expect(byUser.get(c)!.payout).toBe(0);
    // Pot = 3 × 100 + 400. Only qualified players share it.
    const paid = detail.standings.reduce((s, x) => s + (x.payout ?? 0), 0);
    const qualified = detail.standings.filter((s) => s.qualified).length;
    expect(paid).toBe(qualified > 0 ? 700 : 0);
    // Settling again is a no-op.
    await eventsSvc.settle(id);
    expect(await wallet.ledgerSum(b)).toBe((await wallet.getWallet(b)).balance);
    // Closed for play.
    await expect(plinko.drop(a, { bet: 100, rows: 8, risk: "low", clientSeed: "x" }, ctx)).rejects.toMatchObject({ code: "EVENT_CLOSED" });
  });

  it("refunds buy-ins on cancel", async () => {
    const id = await makeEvent({ buyIn: 250 });
    const a = await createUser(db);
    await eventsSvc.join(person(a), id);
    expect((await wallet.getWallet(a)).balance).toBe(STARTING_BALANCE - 250);
    expect(await eventsSvc.cancel(id)).toEqual({ refunded: 1 });
    expect((await wallet.getWallet(a)).balance).toBe(STARTING_BALANCE);
    await expect(eventsSvc.cancel(id)).rejects.toMatchObject({ code: "EVENT_CLOSED" });
    await expect(eventsSvc.join(person(await createUser(db)), id)).rejects.toMatchObject({ code: "EVENT_CLOSED" });
  });
});

describe("same-seed race", () => {
  it("gives every player identical Mines boards, fixed round count, and hides reveals", async () => {
    const id = await makeEvent({ mode: "race", game: "mines", rounds: 3, mines: { size: 4, mines: 5 }, buyIn: 0, topUp: 1000 });
    const [a, b] = [await createUser(db), await createUser(db)];
    for (const u of [a, b]) await eventsSvc.join(person(u), id);
    open();
    const [ev] = await db.select().from(events).where(eq(events.id, id));
    const layouts: number[][][] = [[], []];
    for (const [i, u] of [a, b].entries()) {
      const ctx = (await eventsSvc.resolve(id, u, "mines"))!;
      expect(ctx.race).toBe(true);
      for (let r = 0; r < 3; r++) {
        // The client's own board choice is overridden by the event's.
        const s = await mines.start(u, { bet: 50, size: 5, mines: 1, clientSeed: "mine" }, ctx);
        expect(s.round.size).toBe(4);
        expect(s.round.mines).toBe(5);
        const [row] = await db.select().from(minesRounds).where(eq(minesRounds.id, s.round.id));
        expect(row!.serverSeed).toBe(raceRoundSeed(ev!.seed, r));
        expect(row!.clientSeed).toBe(RACE_CLIENT_SEED);
        layouts[i]!.push(minesPositions(row!.serverSeed, row!.clientSeed, 16, 5));
        // Bust on purpose: the reveal stays hidden during the race.
        const bust = await mines.reveal(u, s.round.id, { tile: layouts[i]![r]![0]!, version: s.round.version });
        expect(bust.round.status).toBe("bust");
        expect(bust.round.minePositions).toBeNull();
        expect(bust.round.reveal).toBeNull();
      }
      await expect(mines.start(u, { bet: 50, mines: 1, clientSeed: "x" }, ctx)).rejects.toMatchObject({ code: "RACE_DONE" });
    }
    expect(layouts[0]).toEqual(layouts[1]);
    // Commit shown during, seed revealed after.
    const during = await eventsSvc.detail(id, a);
    expect(during.commit).toBe(hashServerSeed(ev!.seed));
    expect(during.seed).toBeNull();
    expect(during.me!.roundsLeft).toBe(0);
    close();
    const after = await eventsSvc.detail(id, a);
    expect(after.seed).toBe(ev!.seed);
    // Both finished with the same stack: tied for first, splitting 1st+2nd.
    expect(after.standings.map((s) => s.rank)).toEqual([1, 1]);
    expect(after.standings.map((s) => s.payout)).toEqual([500, 500]);
  });

  it("Hi-Lo race shares the card order; Crash race uses the seed's crash points", async () => {
    const id = await makeEvent({ mode: "race", game: "hilo", rounds: 2, buyIn: 0, topUp: 0 });
    const [a, b] = [await createUser(db), await createUser(db)];
    for (const u of [a, b]) await eventsSvc.join(person(u), id);
    open();
    const decks: number[][] = [];
    for (const u of [a, b]) {
      const ctx = (await eventsSvc.resolve(id, u, "hilo"))!;
      const s = await ladder.start(u, "hilo", { bet: 20, mode: "classic", clientSeed: "zz" }, ctx);
      const [row] = await db.select().from(ladderRounds).where(eq(ladderRounds.id, s.round.id));
      decks.push(hiloCards(row!.serverSeed, row!.clientSeed));
      expect((await ladder.state(u, "hilo")).round).toBeNull();
      expect((await ladder.state(u, "hilo", ctx)).round?.id).toBe(s.round.id);
    }
    expect(decks[0]).toEqual(decks[1]);

    const cid = await makeEvent({ mode: "race", game: "crash", rounds: 2, buyIn: 0, topUp: 0 });
    await eventsSvc.join(person(a), cid);
    open();
    const [ev] = await db.select().from(events).where(eq(events.id, cid));
    const r0 = await eventsSvc.crashRace(a, cid, { bet: 100, targetX100: 150 });
    const crash0 = crashPointX100(raceRoundSeed(ev!.seed, 0), `${cid}:0`);
    expect(r0.crashX100).toBe(crash0);
    expect(r0.won).toBe(crash0 >= 150);
    expect(r0.entry.stack).toBe(1000 - 100 + (r0.won ? 150 : 0));
    await eventsSvc.crashRace(a, cid, { bet: 100, targetX100: 101 });
    await expect(eventsSvc.crashRace(a, cid, { bet: 100, targetX100: 101 })).rejects.toMatchObject({ code: "RACE_DONE" });
  });
});

describe("table games in a free-for-all", () => {
  it("opens separate event tables for blackjack and baccarat that bet the event stack", async () => {
    const { BlackjackService } = await import("../src/games/blackjack/service");
    const { BaccaratService } = await import("../src/games/baccarat/service");
    const bj = new BlackjackService(db, wallet, eventsSvc);
    const bac = new BaccaratService(db, wallet, eventsSvc);
    const id = await makeEvent({ buyIn: 0 });
    const a = await createUser(db);
    await eventsSvc.join(person(a), id);
    open();
    const bjCtx = (await eventsSvc.resolve(id, a, "blackjack"))!;
    const normal = await bj.getTable(a);
    const evTable = await bj.getTable(a, bjCtx);
    expect(evTable.id).not.toBe(normal.id);
    const walletBefore = (await wallet.getWallet(a)).balance;
    const hand = await bj.startRound(a, { tableId: evTable.id, bet: 100 }, bjCtx);
    expect(hand.balance === null || hand.balance <= 1000).toBe(true);
    // The event table can't be played without the event context, and vice versa.
    await expect(bj.startRound(a, { tableId: evTable.id, bet: 100 })).rejects.toMatchObject({ code: "TABLE_NOT_FOUND" });
    expect((await wallet.getWallet(a)).balance).toBe(walletBefore);

    const bacCtx = (await eventsSvc.resolve(id, a, "baccarat"))!;
    const bt = await bac.getTable(a, bacCtx);
    const coup = await bac.play(a, { tableId: bt.id, bets: { player: 100 } }, bacCtx);
    expect(coup.balance).toBeLessThanOrEqual(1100);
    expect((await wallet.getWallet(a)).balance).toBe(walletBefore);
  });
});
