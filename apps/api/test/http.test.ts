import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DAILY_CLAIM_AMOUNT, STARTING_BALANCE } from "@snakeland/shared";
import { buildApp } from "../src/app";
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
});
