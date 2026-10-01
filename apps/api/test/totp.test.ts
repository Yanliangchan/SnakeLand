import { afterAll, describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { hashAdminPassword } from "../src/admin/auth";
import { base32Decode, newTotpSecret, totpAt, verifyTotp } from "../src/admin/totp";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import { testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

// RFC 6238 appendix B: ASCII "12345678901234567890" as base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors (last 6 digits)", () => {
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe("005924");
  });

  it("accepts the current step ±1 only, and rejects malformed codes", () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(s, totpAt(s, step), now)).toBe(step);
    expect(verifyTotp(s, totpAt(s, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(s, totpAt(s, step - 3), now)).toBeNull();
    expect(verifyTotp(s, "12345", now)).toBeNull();
    expect(verifyTotp(s, "abcdef", now)).toBeNull();
  });

  it("requires a fresh, unused code at admin sign-in when configured", async () => {
    const secret = newTotpSecret();
    const env = loadEnv({ ...process.env, ADMIN_PASSWORD_HASH: await hashAdminPassword("pw-for-totp"), ADMIN_TOTP_SECRET: secret });
    const { app } = await buildApp({ env, db, redis: null });
    const login = (body: object): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "POST",
        url: "/v1/admin/login",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
    expect((await login({ password: "pw-for-totp" })).json().error.code).toBe("ADMIN_BAD_CODE");
    expect((await login({ password: "pw-for-totp", code: "000000" })).statusCode).toBe(401);
    const code = totpAt(secret, Math.floor(Date.now() / 30_000));
    expect((await login({ password: "pw-for-totp", code })).statusCode).toBe(200);
    // The same code can't be used twice.
    expect((await login({ password: "pw-for-totp", code })).json().error.code).toBe("ADMIN_BAD_CODE");
    await app.close();
  });
});
