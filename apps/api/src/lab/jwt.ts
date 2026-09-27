import { createHmac, timingSafeEqual } from "node:crypto";

/** Minimal HS256 JWT, just for the Lab's "forge an admin token" challenge. */
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Verify an HS256 token against a secret. Returns the payload, or null. */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  let alg: unknown;
  try {
    alg = (JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: unknown }).alg;
  } catch {
    return null;
  }
  // The whole point is HS256; "none" and others are rejected.
  if (alg !== "HS256") return null;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * A small list of very common passwords. The JWT challenge signs each player's
 * token with one of these, so it can be cracked with any public wordlist.
 */
export const WEAK_SECRETS = [
  "secret",
  "password",
  "123456",
  "letmein",
  "admin",
  "qwerty",
  "welcome",
  "monkey",
  "dragon",
  "football",
  "iloveyou",
  "sunshine",
  "princess",
  "trustno1",
  "superman",
  "batman",
] as const;
