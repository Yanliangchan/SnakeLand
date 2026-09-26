import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CRASH_TIMING, crashMultiplierAt, crashPayout, crashTimeFor, verifyCommit } from "@snakeland/shared";
import { crashBets, crashRounds } from "../src/db/schema";
import { CrashDealer } from "../src/games/crash/dealer";
import { CrashService } from "../src/games/crash/service";
import { MemoryBus } from "../src/realtime/bus";
import { AlwaysLeader } from "../src/realtime/leader";
import { MemoryPresence } from "../src/realtime/presence";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const wallet = new WalletService(db);
const bus = new MemoryBus();
const messages: Array<{ kind: string; userId?: string; message?: { type: string } }> = [];
bus.subscribe((m) => messages.push(m as (typeof messages)[number]));

let clock = new Date(Date.now() + 24 * 60 * 60_000);
const crash = new CrashService(db, wallet, bus, () => clock);
const presence = new MemoryPresence();
presence.set("viewer", { crash: 1 }, true);
const quiet = { error: () => {} };
const dealer = new CrashDealer(db, wallet, crash, bus, new AlwaysLeader(), presence, quiet);

async function live() {
  const round = await crash.liveRound();
  if (!round) throw new Error("no live round");
  return round;
}

/** Pin the crash point so the test is deterministic (the seed commit is still checked separately). */
async function forceCrashPoint(roundId: string, x100: number) {
  const round = await live();
  await db
    .update(crashRounds)
    .set({ crashX100: x100, crashesAt: new Date(round.startsAt.getTime() + crashTimeFor(x100)) })
    .where(eq(crashRounds.id, roundId));
}

async function tickAt(date: Date) {
  clock = date;
  return dealer.tick(date);
}

beforeAll(async () => {
  await db.delete(crashBets);
  await db.delete(crashRounds);
});
afterAll(async () => {
  await dealer.stop();
  await pool.end();
});

describe("Crash", () => {
  it("opens a round with a published commit and hides the crash point", async () => {
    await tickAt(clock);
    const state = await crash.state();
    expect(state.round).toMatchObject({ phase: "betting", crashX100: null, serverSeed: null, crashedAt: null });
    expect(state.round!.commit).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(state)).not.toContain((await live()).serverSeed);
  });

  it("plays a full round: auto cash-out, manual cash-out, cancel, and a loss", async () => {
    const round = await live();
    await forceCrashPoint(round.id, 250);
    const [auto, manual, cancelled, loser, tooHigh] = (await Promise.all(Array.from({ length: 5 }, () => createUser(db)))) as [string, string, string, string, string];

    await crash.bet(auto, { roundId: round.id, amount: 100, autoCashoutX100: 150 });
    await crash.bet(manual, { roundId: round.id, amount: 200 });
    await crash.bet(cancelled, { roundId: round.id, amount: 300 });
    await crash.bet(loser, { roundId: round.id, amount: 400 });
    await crash.bet(tooHigh, { roundId: round.id, amount: 50, autoCashoutX100: 300 });
    await expect(crash.bet(manual, { roundId: round.id, amount: 10 })).rejects.toMatchObject({ code: "ALREADY_BET" });
    expect((await crash.cancel(cancelled, { roundId: round.id })).balance).toBe(1_000);
    expect(await crash.myBet(cancelled, round.id)).toBeNull();
    await expect(crash.cashout(manual, { roundId: round.id })).rejects.toMatchObject({ code: "NOT_STARTED" });

    // Bets close just before takeoff.
    clock = new Date(round.startsAt.getTime() - 100);
    await expect(crash.bet(cancelled, { roundId: round.id, amount: 10 })).rejects.toMatchObject({ code: "BETTING_CLOSED" });

    await tickAt(round.startsAt);
    expect((await live()).phase).toBe("running");

    // The auto cash-out fires when the multiplier reaches 1.50×.
    await tickAt(new Date(round.startsAt.getTime() + crashTimeFor(150)));
    expect(await crash.myBet(auto, round.id)).toMatchObject({ cashoutX100: 150, payout: 150 });
    expect(messages.some((m) => m.kind === "user" && m.userId === auto && m.message?.type === "crash-cashout")).toBe(true);

    // Manual cash-out pays the multiplier at the moment the server sees it.
    const elapsed = crashTimeFor(200) + 5;
    clock = new Date(round.startsAt.getTime() + elapsed);
    const cashed = await crash.cashout(manual, { roundId: round.id });
    const x100 = crashMultiplierAt(elapsed);
    expect(cashed.myBet).toMatchObject({ cashoutX100: x100, payout: crashPayout(200, x100) });
    await expect(crash.cashout(manual, { roundId: round.id })).rejects.toMatchObject({ code: "ALREADY_CASHED_OUT" });

    // Crash at 2.50×: anyone still in loses, and the 3.00× auto never triggered.
    const crashesAt = new Date(round.startsAt.getTime() + crashTimeFor(250));
    clock = crashesAt;
    await expect(crash.cashout(loser, { roundId: round.id })).rejects.toMatchObject({ code: "CRASHED" });
    await tickAt(crashesAt);
    const state = await crash.state();
    expect(state.round).toMatchObject({ id: round.id, phase: "crashed", crashX100: 250 });
    expect(verifyCommit(state.round!.serverSeed!, state.round!.commit)).toBe(true);
    expect(state.recent[0]).toBe(250);
    expect(await crash.myBet(loser, round.id)).toMatchObject({ cashoutX100: null, payout: 0 });
    expect(await crash.myBet(tooHigh, round.id)).toMatchObject({ cashoutX100: null, payout: 0 });
    const settled = messages.filter((m) => m.message?.type === "crash-settled").map((m) => m.userId);
    expect(settled).toEqual(expect.arrayContaining([auto, manual, loser, tooHigh]));

    for (const u of [auto, manual, cancelled, loser, tooHigh]) {
      expect(await wallet.ledgerSum(u)).toBe((await wallet.getWallet(u)).balance);
    }
    expect((await wallet.getWallet(loser)).balance).toBe(600);
  });

  it("opens the next round only while someone is watching, then sleeps", async () => {
    const crashed = (await crash.state()).round!;
    const reopen = new Date(new Date(crashed.crashedAt!).getTime() + CRASH_TIMING.crashedMs);

    const empty = new MemoryPresence();
    const idle = new CrashDealer(db, wallet, crash, bus, new AlwaysLeader(), empty, quiet);
    clock = reopen;
    expect(await idle.tick(reopen)).toBe(false);
    expect(await crash.liveRound()).toBeNull();

    empty.set("someone", { crash: 1 });
    await bus.publish({ kind: "wake", room: "crash" });
    await idle.tick(reopen);
    expect((await crash.liveRound())?.phase).toBe("betting");
    await idle.stop();
  });
});
