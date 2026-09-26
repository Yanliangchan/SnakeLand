import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import {
  ROULETTE_TIMING,
  STARTING_BALANCE,
  rouletteResult,
  rouletteReturn,
  verifyCommit,
  type RouletteServerMessage,
} from "@snakeland/shared";
import { buildApp } from "../src/app";
import { rouletteBets, rouletteRounds } from "../src/db/schema";
import { loadEnv } from "../src/env";
import { RouletteDealer } from "../src/games/roulette/dealer";
import { RouletteService } from "../src/games/roulette/service";
import { MemoryBus } from "../src/realtime/bus";
import { AlwaysLeader } from "../src/realtime/leader";
import { MemoryPresence } from "../src/realtime/presence";
import { WalletService } from "../src/wallet/wallet-service";
import { createUser, testDb } from "./helpers";

const { db, pool } = testDb();
const wallet = new WalletService(db);
const bus = new MemoryBus();
const messages: unknown[] = [];
bus.subscribe((m) => messages.push(m));

let clock = new Date();
const roulette = new RouletteService(db, wallet, bus, () => clock);
const quiet = { error: () => {} };
const presence = new MemoryPresence();
presence.set("viewers", { "roulette:w1": 1, "roulette:w2": 1, "roulette:w3": 1 }, true);
const dealer = new RouletteDealer(db, wallet, roulette, bus, new AlwaysLeader(), presence, quiet);
const TABLE = crypto.randomUUID();

const at = (ms: number) => new Date(clock.getTime() + ms);
async function liveRound(wheelId = "w1") {
  const state = await roulette.wheelState(wheelId as "w1");
  return state.round!;
}

beforeAll(async () => {
  await db.delete(rouletteBets);
  await db.delete(rouletteRounds);
});
afterAll(() => pool.end());

describe("Roulette dealer + bets", () => {
  it("opens all three wheels on staggered clocks with a published commit", async () => {
    clock = new Date();
    await dealer.tick(clock);
    const closes = await Promise.all(["w1", "w2", "w3"].map(async (w) => new Date((await liveRound(w)).closesAt).getTime()));
    expect(closes[1]! - closes[0]!).toBe(8_000);
    expect(closes[2]! - closes[0]!).toBe(16_000);
    const r = await liveRound();
    expect(r.phase).toBe("betting");
    expect(r.commit).toMatch(/^[0-9a-f]{64}$/);
    expect(r.result).toBeNull();
    expect(r.serverSeed).toBeNull();
  });

  it("takes bets, enforces limits, and refunds on clear", async () => {
    const userId = await createUser(db);
    // Enough chips to reach the per-spin cap.
    await wallet.apply({ userId, amount: 20_000, type: "payout", game: "roulette", roundId: crypto.randomUUID() });
    const TOP = STARTING_BALANCE + 20_000;
    const r = await liveRound();
    const res = await roulette.place(userId, {
      wheelId: "w1",
      roundId: r.id,
      tableId: TABLE,
      bets: [
        { betId: "red", amount: 100 },
        { betId: "straight:17", amount: 10 },
        { betId: "red", amount: 50 },
      ],
    });
    expect(res.balance).toBe(TOP - 160);
    expect(res.myBets.total).toBe(160);
    expect(res.myBets.bets.find((b) => b.betId === "red")?.amount).toBe(150);

    await expect(
      roulette.place(userId, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: "split:17-19", amount: 10 }] }),
    ).rejects.toMatchObject({ code: "INVALID_BET" });
    await expect(
      roulette.place(userId, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: "odd", amount: 5 }] }),
    ).rejects.toMatchObject({ code: "BET_OUT_OF_RANGE" });
    await expect(
      roulette.place(userId, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: "odd", amount: 9_900 }] }),
    ).rejects.toMatchObject({ code: "BET_OUT_OF_RANGE" });
    expect((await wallet.getWallet(userId)).balance).toBe(TOP - 160); // rolled back

    const cleared = await roulette.clear(userId, { wheelId: "w1", roundId: r.id });
    expect(cleared.balance).toBe(TOP);
    expect(await wallet.ledgerSum(userId)).toBe(TOP);
    const activity = messages.filter((m) => (m as { message: { type: string } }).message.type === "activity");
    expect(activity.length).toBeGreaterThanOrEqual(2);
  });

  it("closes betting at the deadline, spins to the committed result, settles and reveals", async () => {
    const winner = await createUser(db);
    const loser = await createUser(db);
    const r = await liveRound();
    const [row] = await db.select().from(rouletteRounds).where(eq(rouletteRounds.id, r.id));
    const result = rouletteResult(row!.serverSeed, r.id);
    await roulette.place(winner, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: `straight:${result}`, amount: 20 }] });
    await roulette.place(loser, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: `straight:${(result + 1) % 37}`, amount: 30 }] });

    // Past the published close: the bet path refuses even before the dealer runs.
    clock = new Date(new Date(r.closesAt).getTime());
    await expect(
      roulette.place(winner, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: "red", amount: 10 }] }),
    ).rejects.toMatchObject({ code: "BETTING_CLOSED" });

    await dealer.tick(clock);
    const spinning = await liveRound();
    expect(spinning.phase).toBe("spinning");
    expect(spinning.result).toBe(result);
    expect(spinning.serverSeed).toBeNull();

    messages.length = 0;
    await dealer.tick(at(ROULETTE_TIMING.spinMs));
    const done = await liveRound();
    expect(done.phase).toBe("result");
    expect(verifyCommit(done.serverSeed!, done.commit)).toBe(true);
    expect(rouletteResult(done.serverSeed!, done.id)).toBe(result);

    const settled = messages
      .map((m) => m as { kind: string; userId?: string; message: RouletteServerMessage })
      .filter((m) => m.kind === "user");
    const w = settled.find((m) => m.userId === winner)!.message as Extract<RouletteServerMessage, { type: "settled" }>;
    expect(w.settlement.payout).toBe(rouletteReturn(`straight:${result}`, 20, result));
    expect(w.settlement.balance).toBe(STARTING_BALANCE - 20 + 720);
    const l = settled.find((m) => m.userId === loser)!.message as Extract<RouletteServerMessage, { type: "settled" }>;
    expect(l.settlement.payout).toBe(0);
    expect(l.settlement.balance).toBe(STARTING_BALANCE - 30);
    for (const u of [winner, loser]) expect(await wallet.ledgerSum(u)).toBe((await wallet.getWallet(u)).balance);

    // The next round opens only after the result has been shown.
    await dealer.tick(at(ROULETTE_TIMING.spinMs + 1_000));
    expect((await liveRound()).id).toBe(r.id);
    await dealer.tick(at(ROULETTE_TIMING.spinMs + ROULETTE_TIMING.resultMs));
    const next = await liveRound();
    expect(next.id).not.toBe(r.id);
    expect(next.number).toBe(r.number + 1);
    expect((await roulette.wheelState("w1")).recent[0]).toBe(result);
  });

  it("never loses a chip when bets race the close", async () => {
    clock = new Date(Date.now() + 10 * 60_000);
    // Finish anything live, then wait out the result window so a fresh round opens.
    // close → settle → open, each 30s apart in fake time.
    for (let i = 0; i < 3; i++) await dealer.tick(at(i * 30_000));
    clock = at(2 * 30_000);
    const r = await liveRound();
    expect(r.phase).toBe("betting");
    const users = await Promise.all(Array.from({ length: 12 }, () => createUser(db)));
    clock = new Date(new Date(r.closesAt).getTime() - 1_000); // bets still allowed
    const closeAt = new Date(r.closesAt);
    const results = await Promise.allSettled([
      ...users.map((u) => roulette.place(u, { wheelId: "w1", roundId: r.id, tableId: TABLE, bets: [{ betId: "even", amount: 100 }] })),
      dealer.tick(closeAt),
    ]);
    await dealer.tick(new Date(closeAt.getTime() + ROULETTE_TIMING.spinMs));
    const accepted = results.slice(0, users.length).filter((x) => x.status === "fulfilled").length;
    const bets = await db.select().from(rouletteBets).where(eq(rouletteBets.roundId, r.id));
    expect(bets).toHaveLength(accepted);
    expect(bets.every((b) => b.payout !== null)).toBe(true);
    for (const u of users) expect(await wallet.ledgerSum(u)).toBe((await wallet.getWallet(u)).balance);
  });

  it("stays consistent when two dealers tick at once", async () => {
    const other = new RouletteDealer(db, wallet, roulette, bus, new AlwaysLeader(), presence, quiet);
    const t = new Date(Date.now() + 60 * 60_000);
    await Promise.all([dealer.tick(t), other.tick(t), dealer.tick(new Date(t.getTime() + 60_000)), other.tick(new Date(t.getTime() + 60_000))]);
    const live = await db.select().from(rouletteRounds).where(eq(rouletteRounds.wheelId, "w2"));
    expect(live.filter((x) => x.phase !== "settled").length).toBeLessThanOrEqual(1);
  });
});

describe("Roulette dealer idling", () => {
  it("lets an unwatched wheel sleep after its round, and wakes it on join", async () => {
    const empty = new MemoryPresence();
    const idle = new RouletteDealer(db, wallet, roulette, bus, new AlwaysLeader(), empty, quiet);
    const base = new Date(Date.now() + 3 * 60 * 60_000);
    // Walk every live round to settled and past the result window.
    for (let i = 0; i < 4; i++) await idle.tick(new Date(base.getTime() + i * 60_000));
    const later = new Date(base.getTime() + 10 * 60_000);
    await idle.tick(later);
    const live = async () =>
      (await db.select().from(rouletteRounds).where(eq(rouletteRounds.wheelId, "w3"))).filter((x) => x.phase !== "settled");
    expect(await live()).toHaveLength(0);
    // Nothing live and nobody watching: the loop reports it can sleep.
    expect(await idle.tick(new Date(later.getTime() + 500))).toBe(false);

    empty.set("someone", { "roulette:w3": 1 });
    await bus.publish({ kind: "wake", room: "roulette:w3" });
    await idle.tick(new Date(later.getTime() + 1_000));
    expect(await live()).toHaveLength(1);
    await idle.stop();
  });
});

describe("Roulette WebSocket", () => {
  let app: FastifyInstance;
  let url: string;
  let cookie: string;
  const ORIGIN = "http://localhost:3000";

  beforeAll(async () => {
    const built = await buildApp({ env: loadEnv(), db, redis: null });
    app = built.app;
    await built.dealer.tick(new Date(Date.now() + 2 * 60 * 60_000));
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    url = address.replace("http", "ws") + "/v1/live/ws";
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify({ email: `ws${Date.now()}@example.test`, password: "correct horse battery", name: "Wes" }),
    });
    const raw = res.headers["set-cookie"];
    cookie = (Array.isArray(raw) ? raw : [raw!]).map((c) => c.split(";")[0]).join("; ");
  });
  afterAll(async () => {
    await app.close();
  });

  const connect = (headers: Record<string, string>) =>
    new Promise<{ ws: WebSocket; status?: number }>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on("open", () => resolve({ ws }));
      ws.on("unexpected-response", (_req, res) => resolve({ ws, status: res.statusCode }));
      ws.on("error", () => {});
    });

  it("rejects foreign origins and anonymous connections", async () => {
    expect((await connect({ origin: "https://evil.example", cookie })).status).toBe(403);
    expect((await connect({ origin: ORIGIN })).status).toBe(401);
  });

  it("accepts a single-use ticket instead of a cookie", async () => {
    const issue = () =>
      app.inject({ method: "POST", url: "/v1/live/ws-ticket", headers: { cookie, origin: ORIGIN } }).then((r) => r.json().ticket as string);
    const ticket = await issue();
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ok = await new Promise<{ ws: WebSocket; status?: number }>((resolve) => {
      const ws = new WebSocket(`${url}?ticket=${ticket}`, { headers: { origin: ORIGIN } });
      ws.on("open", () => resolve({ ws }));
      ws.on("unexpected-response", (_q, res) => resolve({ ws, status: res.statusCode }));
    });
    expect(ok.status).toBeUndefined();
    ok.ws.close();
    // Reused, forged, or presented from a foreign origin: refused.
    const reuse = await new Promise<number | undefined>((resolve) => {
      const ws = new WebSocket(`${url}?ticket=${ticket}`, { headers: { origin: ORIGIN } });
      ws.on("open", () => resolve(undefined));
      ws.on("unexpected-response", (_q, res) => resolve(res.statusCode));
    });
    expect(reuse).toBe(401);
    const fresh = await issue();
    const foreign = await new Promise<number | undefined>((resolve) => {
      const ws = new WebSocket(`${url}?ticket=${fresh}`, { headers: { origin: "https://evil.example" } });
      ws.on("open", () => resolve(undefined));
      ws.on("unexpected-response", (_q, res) => resolve(res.statusCode));
    });
    expect(foreign).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/live/ws-ticket", headers: { origin: ORIGIN } })).statusCode).toBe(401);
  });

  it("streams wheel state after join and answers pings", async () => {
    const { ws } = await connect({ origin: ORIGIN, cookie });
    const received: RouletteServerMessage[] = [];
    ws.on("message", (d) => received.push(JSON.parse(d.toString())));
    ws.send(JSON.stringify({ type: "join", room: "roulette:w2" }));
    ws.send(JSON.stringify({ type: "ping" }));
    ws.send("not json");
    await new Promise((r) => setTimeout(r, 400));
    const state = received.find((m) => m.type === "state") as Extract<RouletteServerMessage, { type: "state" }>;
    expect(state.wheel.wheelId).toBe("w2");
    expect(state.serverNow).toBeTruthy();
    expect(received.some((m) => m.type === "pong")).toBe(true);
    expect(received.some((m) => m.type === "error")).toBe(true);
    expect(JSON.stringify(received)).not.toMatch(/"serverSeed":"[0-9a-f]{64}"[^}]*"phase":"betting"/);
    ws.close();
  });
});
