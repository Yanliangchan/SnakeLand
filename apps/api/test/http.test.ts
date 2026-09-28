import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DAILY_CLAIM_AMOUNT, STARTING_BALANCE } from "@snakeland/shared";
import { buildApp } from "../src/app";
import { eq } from "drizzle-orm";
import { users } from "../src/db/schema";
import { loadEnv } from "../src/env";
import { testDb } from "./helpers";

const ORIGIN = "http://localhost:3000";
const { db, pool } = testDb();
let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await buildApp({ env: loadEnv(), db, redis: null }));
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

const email = () => `u${Date.now()}${Math.random().toString(36).slice(2)}@example.test`;

async function signUp(body: Record<string, unknown>, cookie?: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify(body),
  });
}

describe("HTTP", () => {
  it("rejects unauthenticated wallet access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("signs up with an httpOnly session cookie and returns a wallet", async () => {
    const res = await signUp({ email: email(), password: "correct horse battery", name: "Ada" });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: { cookie: cookieFrom(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.headers["cache-control"]).toBe("no-store");
    expect(me.json()).toMatchObject({ user: { name: "Ada", isGuest: false }, wallet: { balance: STARTING_BALANCE } });
  });

  it("rejects weak passwords and bad names", async () => {
    expect((await signUp({ email: email(), password: "short", name: "Ada" })).statusCode).toBe(400);
    expect((await signUp({ email: email(), password: "correct horse battery", name: "x".repeat(40) })).statusCode).toBe(
      400,
    );
  });

  it("rejects auth requests from untrusted origins", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      payload: JSON.stringify({ email: email(), password: "correct horse battery", name: "Eve" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires an allow-listed Origin for state-changing calls (CSRF)", async () => {
    const cookie = cookieFrom(await signUp({ email: email(), password: "correct horse battery", name: "Bo" }));
    const noOrigin = await app.inject({ method: "POST", url: "/v1/wallet/daily-claim", headers: { cookie } });
    expect(noOrigin.statusCode).toBe(403);
    const evil = await app.inject({
      method: "POST",
      url: "/v1/wallet/daily-claim",
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(evil.statusCode).toBe(403);

    const ok = await app.inject({ method: "POST", url: "/v1/wallet/daily-claim", headers: { cookie, origin: ORIGIN } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balance).toBe(STARTING_BALANCE + DAILY_CLAIM_AMOUNT);

    const again = await app.inject({
      method: "POST",
      url: "/v1/wallet/daily-claim",
      headers: { cookie, origin: ORIGIN },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("DAILY_CLAIM_NOT_READY");
  });

  it("lets a guest play, then keeps their chips when they register", async () => {
    const guest = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/anonymous",
      headers: { origin: ORIGIN },
    });
    expect(guest.statusCode).toBe(200);
    const guestCookie = cookieFrom(guest);

    const me = (await app.inject({ method: "GET", url: "/v1/me", headers: { cookie: guestCookie } })).json();
    expect(me.user.isGuest).toBe(true);
    expect(me.user.email).toBeNull();

    await app.inject({
      method: "POST",
      url: "/v1/wallet/daily-claim",
      headers: { cookie: guestCookie, origin: ORIGIN },
    });

    const registered = await signUp({ email: email(), password: "correct horse battery", name: "Cy" }, guestCookie);
    expect(registered.statusCode).toBe(200);
    const after = (
      await app.inject({ method: "GET", url: "/v1/me", headers: { cookie: cookieFrom(registered) } })
    ).json();
    expect(after.user.isGuest).toBe(false);
    expect(after.wallet.balance).toBe(STARTING_BALANCE + DAILY_CLAIM_AMOUNT);
    expect(after.wallet.nextDailyClaimAt).not.toBeNull();
    // The emptied guest is deleted right away.
    expect(await db.select().from(users).where(eq(users.id, me.user.id))).toHaveLength(0);
  });

  it("deletes a guest when it signs out", async () => {
    const guest = await app.inject({ method: "POST", url: "/api/auth/sign-in/anonymous", headers: { origin: ORIGIN } });
    const cookie = cookieFrom(guest);
    const id = (await app.inject({ method: "GET", url: "/v1/me", headers: { cookie } })).json().user.id as string;
    const out = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      payload: "{}",
    });
    expect(out.statusCode).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, id))).toHaveLength(0);
  });

  it("rejects non-JSON bodies", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: ORIGIN, "content-type": "text/plain" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(415);
  });

  it("validates pagination input", async () => {
    const cookie = cookieFrom(await signUp({ email: email(), password: "correct horse battery", name: "Di" }));
    const bad = await app.inject({ method: "GET", url: "/v1/wallet/transactions?limit=1000", headers: { cookie } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "GET", url: "/v1/wallet/transactions?limit=10", headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().items[0]).toMatchObject({ type: "signup_bonus", amount: STARTING_BALANCE });
  });

  it("plays blackjack over HTTP with bet limits and CSRF checks", async () => {
    const cookie = cookieFrom(await signUp({ email: email(), password: "correct horse battery", name: "Ed" }));
    const post = (url: string, payload?: unknown, origin: string | null = ORIGIN) =>
      app.inject({
        method: "POST",
        url,
        headers: { cookie, ...(origin ? { origin } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
        payload: payload ? JSON.stringify(payload) : undefined,
      });

    expect((await post("/v1/blackjack/table", undefined, null)).statusCode).toBe(403);
    const table = (await post("/v1/blackjack/table")).json();
    expect(table.shoe.commit).toMatch(/^[0-9a-f]{64}$/);
    expect(table).not.toHaveProperty("shoe.serverSeed");

    expect((await post("/v1/blackjack/rounds", { tableId: table.id, bet: 5 })).statusCode).toBe(400);
    expect((await post("/v1/blackjack/rounds", { tableId: table.id, bet: 100_001 })).statusCode).toBe(400);
    expect((await post("/v1/blackjack/rounds", { tableId: table.id, bet: 10.5 })).statusCode).toBe(400);
    expect((await post("/v1/blackjack/rounds", { tableId: table.id, bet: 10, clientSeed: "<script>" })).statusCode).toBe(
      400,
    );

    const started = await post("/v1/blackjack/rounds", { tableId: table.id, bet: 100 });
    expect(started.statusCode).toBe(200);
    let update = started.json();
    expect(JSON.stringify(update)).not.toContain("serverSeed");
    while (update.round.phase !== "settled") {
      const action = update.round.allowed.includes("stand") ? "stand" : "no_insurance";
      const res = await post(`/v1/blackjack/rounds/${update.round.id}/actions`, {
        action,
        version: update.round.version,
      });
      expect(res.statusCode).toBe(200);
      update = res.json();
    }
    expect(update.round.dealer.revealed).toBe(true);
    expect(update.recent).toHaveLength(1);

    const bogus = await post("/v1/blackjack/rounds/not-a-uuid/actions", { action: "hit", version: 1 });
    expect(bogus.statusCode).toBe(400);
  });

  it("validates Mines and Plinko requests and never leaks the live seed", async () => {
    const cookie = cookieFrom(await signUp({ email: email(), password: "correct horse battery", name: "Flo" }));
    const post = (url: string, payload: unknown, origin: string | null = ORIGIN) =>
      app.inject({
        method: "POST",
        url,
        headers: { cookie, "content-type": "application/json", ...(origin ? { origin } : {}) },
        payload: JSON.stringify(payload),
      });

    expect((await post("/v1/plinko/drops", { bet: 10, rows: 8, risk: "low", clientSeed: "a" }, null)).statusCode).toBe(403);
    expect((await post("/v1/plinko/drops", { bet: 10, rows: 7, risk: "low", clientSeed: "a" })).statusCode).toBe(400);
    expect((await post("/v1/plinko/drops", { bet: 10, rows: 8, risk: "wild", clientSeed: "a" })).statusCode).toBe(400);
    expect((await post("/v1/plinko/drops", { bet: 9, rows: 8, risk: "low", clientSeed: "a" })).statusCode).toBe(400);
    expect((await post("/v1/plinko/drops", { bet: 10, rows: 8, risk: "low", clientSeed: "a b" })).statusCode).toBe(400);
    const drop = await post("/v1/plinko/drops", { bet: 10, rows: 8, risk: "low", clientSeed: "a" });
    expect(drop.statusCode).toBe(200);
    expect(drop.json().drop.path).toHaveLength(8);

    expect((await post("/v1/mines/rounds", { bet: 10, mines: 0, clientSeed: "a" })).statusCode).toBe(400);
    expect((await post("/v1/mines/rounds", { bet: 10, mines: 25, clientSeed: "a" })).statusCode).toBe(400);
    const started = await post("/v1/mines/rounds", { bet: 10, mines: 3, clientSeed: "a" });
    expect(started.statusCode).toBe(200);
    expect(started.body).not.toContain("serverSeed");
    const state = await post("/v1/mines/state", {});
    expect(state.body).not.toContain("serverSeed");
    expect(state.json().round.minePositions).toBeNull();
    const id = started.json().round.id;
    expect((await post(`/v1/mines/rounds/${id}/reveal`, { tile: -1, version: 1 })).statusCode).toBe(400);
    expect((await post(`/v1/mines/rounds/${id}/reveal`, { tile: 1.5, version: 1 })).statusCode).toBe(400);
  });
});

