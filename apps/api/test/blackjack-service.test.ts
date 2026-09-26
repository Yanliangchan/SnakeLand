import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  STARTING_BALANCE,
  hashServerSeed,
  handValue,
  orderedShoe,
  shuffleShoe,
  verifyCommit,
  type BlackjackUpdateDTO,
  type Card,
} from "@snakeland/shared";
import { blackjackRounds, blackjackShoes } from "../src/db/schema";
import { BlackjackService } from "../src/games/blackjack/service";
import { allowedActions, type EngineState } from "../src/games/blackjack/engine";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const wallet = new WalletService(db);
const bj = new BlackjackService(db, wallet);
const SERVER_SEED = "5".repeat(64);

/** Re-seed a table's unused live shoe so its first four cards satisfy `want`. */
async function rigShoe(tableId: string, want: (first: Card[]) => boolean) {
  const ordered = orderedShoe(6);
  for (let i = 0; i < 20_000; i++) {
    const clientSeed = `rig${i}`;
    const cards = shuffleShoe(ordered, SERVER_SEED, clientSeed);
    if (want(cards.slice(0, 6))) {
      await db
        .update(blackjackShoes)
        .set({ serverSeed: SERVER_SEED, serverSeedHash: hashServerSeed(SERVER_SEED), clientSeed })
        .where(and(eq(blackjackShoes.tableId, tableId), isNull(blackjackShoes.revealedAt)));
      return cards;
    }
  }
  throw new Error("no matching shoe found");
}

const ten = (c: Card) => "TJQK".includes(c[0]!);
/** Player 5/6-ish hard total, dealer upcard 2-9: a plain hand that needs a decision. */
const plainHand = ([p1, up, p2]: Card[]) =>
  !ten(up!) && up![0] !== "A" && handValue([p1!, p2!]).total >= 9 && handValue([p1!, p2!]).total <= 11 && p1![0] !== p2![0];

async function playOut(userId: string, update: BlackjackUpdateDTO): Promise<BlackjackUpdateDTO> {
  let u = update;
  while (u.round.phase !== "settled") {
    const choice = u.round.allowed.includes("stand") ? "stand" : "no_insurance";
    u = await bj.act(userId, u.round.id, { action: choice, version: u.round.version });
  }
  return u;
}

describe("BlackjackService", () => {
  it("opens exactly one table per user, even under concurrency", async () => {
    const userId = await createUser(db);
    const tables = await Promise.all(Array.from({ length: 6 }, () => bj.getTable(userId)));
    expect(new Set(tables.map((t) => t.id)).size).toBe(1);
    expect(tables[0]!.shoe.cardsRemaining).toBe(312);
    expect(tables[0]!.shoe.commit).toMatch(/^[0-9a-f]{64}$/);
    expect(tables[0]!.round).toBeNull();
  });

  it("debits the bet, hides the hole card, and resumes the hand on reload", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    await rigShoe(table.id, plainHand);

    const u = await bj.startRound(userId, { tableId: table.id, bet: 100 });
    expect(u.balance).toBe(STARTING_BALANCE - 100);
    expect(u.round.phase).toBe("player");
    expect(u.round.dealer.cards[1]!.code).toBeNull();
    expect(u.round.dealer.revealed).toBe(false);
    expect(u.round.allowed).toEqual(expect.arrayContaining(["hit", "stand", "double"]));

    const reloaded = await bj.getTable(userId);
    expect(reloaded.round?.id).toBe(u.round.id);
    expect(reloaded.round?.dealer.cards[1]!.code).toBeNull();
  });

  it("rejects stale versions, illegal actions, and other users", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    await rigShoe(table.id, plainHand);
    const u = await bj.startRound(userId, { tableId: table.id, bet: 50 });

    await expect(bj.act(userId, u.round.id, { action: "hit", version: u.round.version + 5 })).rejects.toMatchObject({
      code: "STALE_VERSION",
    });
    await expect(bj.act(userId, u.round.id, { action: "insurance", version: u.round.version })).rejects.toMatchObject({
      code: "ILLEGAL_ACTION",
    });
    const intruder = await createUser(db);
    await expect(bj.act(intruder, u.round.id, { action: "stand", version: u.round.version })).rejects.toMatchObject({
      code: "ROUND_NOT_FOUND",
    });
    await expect(bj.startRound(intruder, { tableId: table.id, bet: 50 })).rejects.toMatchObject({
      code: "TABLE_NOT_FOUND",
    });
  });

  it("applies each action exactly once when double-submitted", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    await rigShoe(table.id, plainHand);
    const u = await bj.startRound(userId, { tableId: table.id, bet: 100 });
    const results = await Promise.allSettled([
      bj.act(userId, u.round.id, { action: "double", version: u.round.version }),
      bj.act(userId, u.round.id, { action: "double", version: u.round.version }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const staked = (await wallet.listTransactions(userId, { limit: 10 })).items.filter((t) => t.type === "bet");
    expect(staked.reduce((s, t) => s + t.amount, 0)).toBe(-200);
  });

  it("allows one hand at a time and blocks leaving mid-hand", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    await rigShoe(table.id, plainHand);
    const u = await bj.startRound(userId, { tableId: table.id, bet: 10 });
    await expect(bj.startRound(userId, { tableId: table.id, bet: 10 })).rejects.toMatchObject({
      code: "ROUND_IN_PROGRESS",
    });
    await expect(bj.nextTable(userId)).rejects.toMatchObject({ code: "ROUND_IN_PROGRESS" });
    await playOut(userId, u);
    const next = await bj.nextTable(userId);
    expect(next.table.id).not.toBe(table.id);
    expect(next.table.recent).toEqual([]);
    expect(next.revealedShoe?.serverSeed).toBe(SERVER_SEED);
    expect(verifyCommit(next.revealedShoe!.serverSeed, next.revealedShoe!.commit)).toBe(true);
  });

  it("rolls back a double the player can't afford", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    await rigShoe(table.id, plainHand);
    // Leave exactly enough for the opening bet.
    await wallet.apply({ userId, amount: -(STARTING_BALANCE - 100), type: "bet", game: "mines", roundId: crypto.randomUUID() });
    const u = await bj.startRound(userId, { tableId: table.id, bet: 100 });
    expect(u.balance).toBe(0);
    await expect(bj.act(userId, u.round.id, { action: "double", version: u.round.version })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
    const [row] = await db.select().from(blackjackRounds).where(eq(blackjackRounds.id, u.round.id));
    expect(row!.version).toBe(u.round.version);
    expect(allowedActions(row!.state as EngineState)).toContain("double");
    expect(await wallet.ledgerSum(userId)).toBe(0);
  });

  it("uses the client seed supplied on the shoe's first deal", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    const u = await bj.startRound(userId, { tableId: table.id, bet: 10, clientSeed: "my-lucky-seed" });
    expect(u.shoe.clientSeed).toBe("my-lucky-seed");
  });

  it("plays a whole shoe: ledger balances, cut card reshuffles, and every hand replays from the revealed seeds", async () => {
    const userId = await createUser(db);
    const table = await bj.getTable(userId);
    const firstShoe = table.shoe;
    let staked = 0;
    let paid = 0;
    let revealed: BlackjackUpdateDTO["revealedShoe"] = null;
    let rounds = 0;
    let rng = 7;
    const rand = () => ((rng = (rng * 48271) % 2147483647) / 2147483647);

    while (!revealed) {
      let u = await bj.startRound(userId, { tableId: table.id, bet: 10 });
      while (u.round.phase !== "settled") {
        const options = u.round.allowed;
        u = await bj.act(userId, u.round.id, {
          action: options[Math.floor(rand() * options.length)]!,
          version: u.round.version,
        });
      }
      staked += u.round.totalBet;
      paid += u.round.totalPayout ?? 0;
      revealed = u.revealedShoe;
      if (revealed) expect(u.shoe.id).not.toBe(firstShoe.id);
      expect(++rounds).toBeLessThan(200);
    }

    const w = await wallet.getWallet(userId);
    expect(w.balance).toBe(STARTING_BALANCE - staked + paid);
    expect(await wallet.ledgerSum(userId)).toBe(w.balance);

    // Anyone holding the revealed seeds can rebuild every card of every hand.
    expect(revealed.id).toBe(firstShoe.id);
    expect(verifyCommit(revealed.serverSeed, firstShoe.commit)).toBe(true);
    const cards = shuffleShoe(orderedShoe(revealed.decks), revealed.serverSeed, revealed.clientSeed!);
    const rows = await db.select().from(blackjackRounds).where(eq(blackjackRounds.shoeId, revealed.id));
    expect(rows).toHaveLength(rounds);
    for (const row of rows) {
      const state = row.state as EngineState;
      for (const c of [...state.hands.flatMap((h) => h.cards), ...state.dealer]) {
        expect(c.code).toBe(cards[row.shoeStart + c.seq]);
      }
    }
  });
});
