import { afterAll, describe, expect, it } from "vitest";
import {
  CROSSING_CONFIG,
  applyX100,
  carrierFlight,
  crossingHitLane,
  hiloCards,
  hiloNextX100,
  hiloWins,
  ladderMultiplierX100,
  penaltyKeeper,
  towerLayout,
  verifyCommit,
} from "@snakeland/shared";
import { CarrierService } from "../src/games/arcade/carrier";
import { LadderService } from "../src/games/arcade/ladder";
import { FairSeedService } from "../src/games/fair-seeds";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const wallet = new WalletService(db);
const seeds = new FairSeedService(db);
const carrier = new CarrierService(db, wallet, seeds);
const ladder = new LadderService(db, wallet, seeds);
afterAll(() => pool.end());

const reconciled = async (u: string) => expect(await wallet.ledgerSum(u)).toBe((await wallet.getWallet(u)).balance);

describe("Carrier", () => {
  it("flies, pays only on landing, and reveals a verifiable seed", async () => {
    const u = await createUser(db);
    let landed = 0;
    for (let i = 0; i < 20; i++) {
      const commit = await carrier.nextCommit(u);
      const { flight } = await carrier.fly(u, { bet: 10, mode: "calm", clientSeed: `c${i}` });
      expect(flight.reveal.commit).toBe(commit);
      expect(verifyCommit(flight.reveal.serverSeed, commit)).toBe(true);
      const again = carrierFlight(flight.reveal.serverSeed, `c${i}`, "calm");
      expect(again.events).toEqual(flight.events);
      expect(flight.payout).toBe(applyX100(10, again.multiplierX100));
      if (flight.landed) landed++;
    }
    expect(landed).toBeGreaterThan(0);
    await reconciled(u);
  });

  it("rejects bad input", async () => {
    const u = await createUser(db);
    await expect(carrier.fly(u, { bet: 5, mode: "calm", clientSeed: "x" })).rejects.toMatchObject({ code: "BET_OUT_OF_RANGE" });
    await expect(carrier.fly(u, { bet: 10, mode: "warp" as "calm", clientSeed: "x" })).rejects.toMatchObject({ code: "INVALID_MODE" });
  });
});

describe("Tower", () => {
  it("climbs safe doors, cashes out, and keeps one round per player", async () => {
    const u = await createUser(db);
    const { round } = await ladder.start(u, "tower", { bet: 100, mode: "easy", clientSeed: "tower-seed" });
    await expect(ladder.start(u, "tower", { bet: 100, mode: "easy", clientSeed: "x" })).rejects.toMatchObject({ code: "ROUND_IN_PROGRESS" });
    // Crossing is a separate game, so it can run at the same time.
    await ladder.start(u, "crossing", { bet: 10, mode: "easy", clientSeed: "x" });

    const seed = (await db.execute<{ server_seed: string }>(`select server_seed from ladder_rounds where id = '${round.id}'`)).rows[0]!.server_seed;
    const layout = towerLayout(seed, "tower-seed", "easy");
    let r = round;
    for (let f = 0; f < 3; f++) r = (await ladder.step(u, "tower", r.id, { version: r.version, door: layout[f]![0]! })).round;
    expect(r).toMatchObject({ level: 3, multiplierX100: ladderMultiplierX100("tower", "easy", 3), towerLayout: null });
    await expect(ladder.step(u, "tower", r.id, { version: 1, door: 0 })).rejects.toMatchObject({ code: "STALE_VERSION" });
    const done = await ladder.cashOut(u, "tower", r.id, { version: r.version });
    expect(done.round).toMatchObject({ status: "cashed_out", payout: applyX100(100, r.multiplierX100) });
    expect(done.round.towerLayout).toEqual(layout);
    await reconciled(u);
  });

  it("busts on a trapped door", async () => {
    const u = await createUser(db);
    const { round } = await ladder.start(u, "tower", { bet: 50, mode: "hard", clientSeed: "trap" });
    const seed = (await db.execute<{ server_seed: string }>(`select server_seed from ladder_rounds where id = '${round.id}'`)).rows[0]!.server_seed;
    const trap = towerLayout(seed, "trap", "hard")[0]![0] === 0 ? 1 : 0;
    const res = await ladder.step(u, "tower", round.id, { version: round.version, door: trap });
    expect(res.round).toMatchObject({ status: "bust", payout: 0, picks: [trap] });
    expect((await wallet.getWallet(u)).balance).toBe(950);
    await reconciled(u);
  });
});

describe("Crossing", () => {
  it("hops until the fatal lane", async () => {
    const u = await createUser(db);
    const { round } = await ladder.start(u, "crossing", { bet: 20, mode: "daredevil", clientSeed: "road" });
    const seed = (await db.execute<{ server_seed: string }>(`select server_seed from ladder_rounds where id = '${round.id}'`)).rows[0]!.server_seed;
    const hit = crossingHitLane(seed, "road", "daredevil");
    let r = round;
    const lanes = CROSSING_CONFIG.daredevil.lanes;
    for (let i = 0; i < lanes && r.status === "playing"; i++) r = (await ladder.step(u, "crossing", r.id, { version: r.version })).round;
    if (hit === null) expect(r).toMatchObject({ status: "cashed_out", level: lanes });
    else expect(r).toMatchObject({ status: "bust", level: hit, crossingHitLane: hit });
    await reconciled(u);
  });
});

const serverSeed = async (id: string) =>
  (await db.execute<{ server_seed: string }>(`select server_seed from ladder_rounds where id = '${id}'`)).rows[0]!.server_seed;

describe("Penalty", () => {
  it("scores past the keeper, hides future dives, and busts on a save", async () => {
    const u = await createUser(db);
    let { round } = await ladder.start(u, "penalty", { bet: 100, mode: "medium", clientSeed: "pk" });
    const keeper = penaltyKeeper(await serverSeed(round.id), "pk", "medium");
    expect(round.penaltyKeeper).toEqual([]);
    const open = (k: number) => [0, 1, 2].find((s) => !keeper[k]!.includes(s))!;
    ({ round } = await ladder.step(u, "penalty", round.id, { version: round.version, door: open(0) }));
    expect(round.level).toBe(1);
    expect(round.penaltyKeeper).toEqual([keeper[0]]);
    expect(round.multiplierX100).toBe(ladderMultiplierX100("penalty", "medium", 1));
    await expect(ladder.step(u, "penalty", round.id, { version: round.version, door: 3 })).rejects.toMatchObject({ code: "INVALID_SPOT" });
    ({ round } = await ladder.step(u, "penalty", round.id, { version: round.version, door: keeper[1]![0]! }));
    expect(round.status).toBe("bust");
    expect(round.penaltyKeeper).toHaveLength(10);
    await reconciled(u);
  });
});

describe("Hi-Lo", () => {
  it("follows the seeded cards, refuses no-gain guesses, and pays on cash out", async () => {
    const u = await createUser(db);
    let { round } = await ladder.start(u, "hilo", { bet: 100, mode: "classic", clientSeed: "hl" });
    const cards = hiloCards(await serverSeed(round.id), "hl");
    expect(round.hiloCards).toEqual([cards[0]]);
    expect(round.hiloNext).toEqual(hiloNextX100(cards, [], cards[0]!));
    await expect(ladder.cashOut(u, "hilo", round.id, { version: round.version })).rejects.toMatchObject({ code: "NOTHING_TO_CASH_OUT" });

    // Always guess the side that can gain; stop at the first win or loss.
    for (let i = 0; i < 52 && round.status === "playing" && round.level === 0; i++) {
      const next = round.hiloNext!;
      const choice = next.higher !== null && (next.lower === null || next.higher <= next.lower) ? "higher" : "lower";
      const won = hiloWins(cards[i]!, cards[i + 1]!, choice);
      ({ round } = await ladder.step(u, "hilo", round.id, { version: round.version, choice }));
      expect(round.status).toBe(won ? "playing" : "bust");
      expect(round.hiloCards).toEqual(cards.slice(0, i + 2));
    }
    if (round.status === "playing") {
      const x = round.multiplierX100;
      ({ round } = await ladder.step(u, "hilo", round.id, { version: round.version, choice: "skip" }));
      expect(round.multiplierX100).toBe(x);
      const { round: done, balance } = await ladder.cashOut(u, "hilo", round.id, { version: round.version });
      expect(done.payout).toBe(applyX100(100, x));
      expect(balance).toBeGreaterThan(0);
    }
    await reconciled(u);
  });

  it("rejects a guess that can't win anything", async () => {
    const u = await createUser(db);
    // Find a seed whose first card is an ace or a king.
    for (let i = 0; i < 200; i++) {
      const { round } = await ladder.start(u, "hilo", { bet: 10, mode: "classic", clientSeed: `edge${i}` });
      const rank = (round.hiloCards![0]! % 13) + 1;
      if (rank === 1 || rank === 13) {
        const bad = rank === 1 ? "higher" : "lower";
        expect(round.hiloNext![bad]).toBeNull();
        await expect(ladder.step(u, "hilo", round.id, { version: round.version, choice: bad })).rejects.toMatchObject({ code: "NO_GAIN" });
        return;
      }
      await ladder.step(u, "hilo", round.id, { version: round.version, choice: "skip" });
      // Skipping doesn't end the round; bust it quickly by walking to a loss.
      await db.execute(`update ladder_rounds set status = 'bust', payout = 0 where id = '${round.id}'`);
    }
    throw new Error("no ace or king in 200 seeds");
  });
});
