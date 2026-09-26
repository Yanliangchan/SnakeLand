import { afterAll, describe, expect, it } from "vitest";
import {
  CROSSING_CONFIG,
  applyX100,
  carrierFlight,
  crossingHitLane,
  ladderMultiplierX100,
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
