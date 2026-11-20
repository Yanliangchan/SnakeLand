import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { STARTING_BALANCE, pokerBuyIn, type PokerTableId } from "@snakeland/shared";
import { pokerHands, pokerSessions, pokerTables } from "../src/db/schema";
import type { TableState } from "../src/games/poker/engine";
import { PokerService, publicView } from "../src/games/poker/service";
import { PurgeService } from "../src/maintenance/purge";
import { MemoryBus } from "../src/realtime/bus";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const wallet = new WalletService(db);
const bus = new MemoryBus();
const messages: Array<{ kind: string; userId?: string; message?: { type: string } }> = [];
bus.subscribe((m) => messages.push(m as (typeof messages)[number]));
let clock = new Date("2026-03-01T12:00:00Z");
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const poker = new PokerService(db, wallet, bus, () => clock, rand);
const T: PokerTableId = "low";
let firstUser = "";

async function state(id: PokerTableId = T) {
  const [row] = await db.select().from(pokerTables).where(eq(pokerTables.id, id));
  return { t: row!.state as TableState, version: row!.version };
}

/** Run the table's clock until `until` is true (or a step limit is hit). */
async function run(until: (t: TableState) => boolean, opts: { act?: (t: TableState) => Promise<void>; limit?: number } = {}) {
  for (let i = 0; i < (opts.limit ?? 400); i++) {
    const { t } = await state();
    if (process.env.TRACE) console.log(i, t.hand?.number, t.hand?.street, t.hand?.ended, t.hand?.toAct, t.nextAt, clock.toISOString());
    if (until(t)) return t;
    if (opts.act) await opts.act(t);
    const after = (await state()).t;
    if (until(after)) return after;
    if (after.nextAt) clock = new Date(Math.max(clock.getTime(), Date.parse(after.nextAt)));
    await poker.step(T, false, clock);
  }
  throw new Error("table never got there");
}

beforeAll(async () => {
  await db.delete(pokerSessions);
  await db.delete(pokerHands);
  await db.delete(pokerTables);
});
afterAll(() => pool.end());

describe("poker tables", () => {
  it("buys in from the wallet, fills the table with bots and deals", async () => {
    const userId = await createUser(db);
    firstUser = userId;
    await expect(poker.sit({ id: userId, name: "Ann" }, T, 10)).rejects.toMatchObject({ code: "BAD_BUY_IN" });
    await expect(poker.sit({ id: userId, name: "Ann" }, T, 2_000)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect((await wallet.getWallet(userId)).balance).toBe(STARTING_BALANCE);
    expect(await db.select().from(pokerSessions)).toHaveLength(0);

    const { me } = await poker.sit({ id: userId, name: "Ann" }, T, 800);
    expect(me.seat).not.toBeNull();
    expect((await wallet.getWallet(userId)).balance).toBe(STARTING_BALANCE - 800);
    await expect(poker.sit({ id: userId, name: "Ann" }, "mid", 4_000)).rejects.toMatchObject({ code: "ALREADY_SEATED" });

    await poker.step(T, false, clock);
    const { t, version } = await state();
    expect(t.seats.every(Boolean)).toBe(true);
    expect(t.seats.filter((s) => s!.kind === "bot")).toHaveLength(5);
    expect(t.hand).not.toBeNull();

    // My cards come to me privately; the public view never carries hole cards.
    const view = await poker.view(T, userId);
    expect(view.me.cards).toHaveLength(2);
    const pub = JSON.stringify(publicView(T, t, version));
    for (const p of t.hand!.players) for (const c of p?.hole ?? []) expect(pub).not.toContain(`"${c}"`);
    expect(pub).not.toContain(t.hand!.seed);
    const mine = messages.filter((m) => m.kind === "user" && m.userId === userId && m.message?.type === "poker-me");
    expect(mine.length).toBeGreaterThan(0);
  });

  it("plays hands to the end, records them, and never creates or loses chips", async () => {
    const [session] = await db.select().from(pokerSessions);
    const userId = session!.userId;
    const total = async () => {
      const { t } = await state();
      const h = t.hand;
      const onTable = t.seats.reduce((s, x) => s + (x?.stack ?? 0), 0);
      const middle = h && !h.ended ? h.pot + h.players.reduce((s, p) => s + (p?.bet ?? 0), 0) : 0;
      return onTable + middle;
    };
    const handsBefore = (await db.select().from(pokerHands)).length;
    // I call or check whenever it's my turn.
    const myMove = async (t: TableState) => {
      const h = t.hand;
      if (!h || h.ended || h.toAct === null) return;
      const s = t.seats[h.toAct];
      if (s?.userId !== userId) return;
      const p = h.players[h.toAct]!;
      const toCall = h.currentBet - p.bet;
      // Cheap calls only, so a random hand doesn't go broke in the test.
      await poker.act(userId, T, { kind: toCall === 0 ? "check" : toCall <= 2 * h.bb ? "call" : "fold" });
    };
    let lastHand = (await state()).t.hand!.number;
    for (let n = 0; n < 3; n++) {
      const before = await total();
      const ended = await run((t) => !!t.hand?.ended && t.hand.number === lastHand, { act: myMove });
      const after = ended.seats.reduce((s, x) => s + (x?.stack ?? 0), 0);
      // Bots get topped up between hands, never during one: within a hand only the rake leaves.
      expect(after + ended.hand!.rake).toBe(before);
      expect(ended.hand!.rake).toBe(0); // one real player: never raked
      lastHand++;
      await run((t) => !!t.hand && !t.hand.ended && t.hand.number === lastHand);
    }
    const hands = await db.select().from(pokerHands);
    expect(hands.length).toBeGreaterThanOrEqual(handsBefore + 3);
    expect(hands.every((h) => /^[0-9a-f]{64}$/.test(h.serverSeed))).toBe(true);
  });

  it("a second player takes a bot's seat after the hand, and leaving cashes out exactly the stack", async () => {
    const other = await createUser(db);
    const res = await poker.sit({ id: other, name: "Bo" }, T, 1_000);
    const { t } = await state();
    const handOn = !!t.hand && !t.hand.ended;
    if (handOn) expect(res.me.reservedSeat ?? res.me.seat).not.toBeNull();
    // Leave while waiting for the seat: the buy-in comes straight back.
    if (res.me.reservedSeat !== null) {
      const left = await poker.leave(other);
      expect(left.pending).toBe(false);
      expect((await wallet.getWallet(other)).balance).toBe(STARTING_BALANCE);
      expect(await wallet.ledgerSum(other)).toBe(STARTING_BALANCE);
    } else {
      await poker.leave(other);
      await run((x) => !x.seats.some((s) => s?.userId === other));
      expect(await wallet.ledgerSum(other)).toBe((await wallet.getWallet(other)).balance);
    }

    const [session] = await db.select().from(pokerSessions).where(eq(pokerSessions.userId, firstUser));
    const userId = session!.userId;
    const left = await poker.leave(userId);
    const after = await run((x) => !x.seats.some((s) => s?.userId === userId), { limit: 600 });
    expect(after.seats.some((s) => s?.userId === userId)).toBe(false);
    const [closed] = await db.select().from(pokerSessions).where(eq(pokerSessions.id, session!.id));
    expect(closed!.closedAt).not.toBeNull();
    const bal = (await wallet.getWallet(userId)).balance;
    expect(bal).toBe(STARTING_BALANCE - 800 + closed!.cashOut!);
    expect(await wallet.ledgerSum(userId)).toBe(bal);
    expect(left.me?.seat === null || left.pending).toBe(true);
  });

  it("stands a player up after two missed turns and returns their chips", async () => {
    const userId = await createUser(db);
    await poker.sit({ id: userId, name: "Cy" }, T, pokerBuyIn(T).min);
    const t = await run((x) => !x.seats.some((s) => s?.userId === userId), { limit: 600 });
    expect(t.seats.some((s) => s?.userId === userId)).toBe(false);
    const [s] = await db.select().from(pokerSessions).where(eq(pokerSessions.userId, userId));
    expect(s!.closedAt).not.toBeNull();
    expect(await wallet.ledgerSum(userId)).toBe((await wallet.getWallet(userId)).balance);
    expect((await wallet.getWallet(userId)).balance).toBe(STARTING_BALANCE - pokerBuyIn(T).min + s!.cashOut!);
  });

  it("a guest who signs up keeps their seat; a purged guest's seat is dropped without paying anyone", async () => {
    const guest = await createUser(db, { anonymous: true });
    const member = await createUser(db);
    await poker.sit({ id: guest, name: "Guest 1" }, T, 400);
    await poker.transferSeat(guest, member, "Dee");
    const { t } = await state();
    const seatOrRes = [...t.seats, ...t.reservations].find((x) => x?.userId === member);
    expect(seatOrRes?.name).toBe("Dee");
    const [s] = await db.select().from(pokerSessions).where(eq(pokerSessions.userId, member));
    expect(s!.closedAt).toBeNull();
    await poker.leave(member);
    await run((x) => ![...x.seats, ...x.reservations].some((y) => y?.userId === member));
    expect(await wallet.ledgerSum(member)).toBe((await wallet.getWallet(member)).balance);

    const guest2 = await createUser(db, { anonymous: true });
    await poker.sit({ id: guest2, name: "Guest 2" }, T, 400);
    expect(await new PurgeService(db).purgeGuest(guest2)).toBe(true);
    // The dealer drops the orphaned seat once it stands up, and nothing breaks.
    const after = await run((x) => ![...x.seats, ...x.reservations].some((y) => y?.userId === guest2), { limit: 800 });
    expect(after.seats.filter(Boolean).length).toBe(6);
  });
});
