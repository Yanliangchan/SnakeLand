import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Redis } from "ioredis";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 32;

export const ADMIN_SESSION_TTL_S = 4 * 60 * 60;
/** Failed logins allowed per IP, and in total, per window before logins lock. */
export const ADMIN_MAX_FAILS_PER_IP = 5;
export const ADMIN_MAX_FAILS_TOTAL = 30;
export const ADMIN_LOCK_WINDOW_S = 15 * 60;

/** `scrypt$<salt b64>$<hash b64>`. Generate with `pnpm --filter @snakeland/api admin:hash`. */
export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length !== KEY_LEN) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), KEY_LEN, SCRYPT);
  return timingSafeEqual(actual, expected);
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Admin sessions and login throttling. Only a hash of the session token is
 * stored, so a leaked store can't be replayed as a cookie.
 */
export interface AdminStore {
  createSession(): Promise<string>;
  hasSession(token: string): Promise<boolean>;
  endSession(token: string): Promise<void>;
  /** Current failure counts for this IP and overall. */
  failures(ip: string): Promise<{ ip: number; total: number }>;
  recordFailure(ip: string): Promise<void>;
  clearFailures(ip: string): Promise<void>;
}

export class MemoryAdminStore implements AdminStore {
  private sessions = new Map<string, number>();
  private fails = new Map<string, { n: number; until: number }>();
  private bump(key: string) {
    const now = Date.now();
    const cur = this.fails.get(key);
    const next = cur && cur.until > now ? { n: cur.n + 1, until: cur.until } : { n: 1, until: now + ADMIN_LOCK_WINDOW_S * 1000 };
    this.fails.set(key, next);
  }
  private count(key: string) {
    const cur = this.fails.get(key);
    return cur && cur.until > Date.now() ? cur.n : 0;
  }
  async createSession() {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(digest(token), Date.now() + ADMIN_SESSION_TTL_S * 1000);
    return token;
  }
  async hasSession(token: string) {
    const until = this.sessions.get(digest(token));
    return until !== undefined && until > Date.now();
  }
  async endSession(token: string) {
    this.sessions.delete(digest(token));
  }
  async failures(ip: string) {
    return { ip: this.count(`ip:${ip}`), total: this.count("all") };
  }
  async recordFailure(ip: string) {
    this.bump(`ip:${ip}`);
    this.bump("all");
  }
  async clearFailures(ip: string) {
    this.fails.delete(`ip:${ip}`);
  }
}

export class RedisAdminStore implements AdminStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "snk:admin:",
  ) {}
  async createSession() {
    const token = randomBytes(32).toString("base64url");
    await this.redis.set(`${this.prefix}s:${digest(token)}`, "1", "EX", ADMIN_SESSION_TTL_S);
    return token;
  }
  async hasSession(token: string) {
    return (await this.redis.exists(`${this.prefix}s:${digest(token)}`)) === 1;
  }
  async endSession(token: string) {
    await this.redis.del(`${this.prefix}s:${digest(token)}`);
  }
  async failures(ip: string) {
    const [a, b] = await this.redis.mget(`${this.prefix}f:${ip}`, `${this.prefix}f:all`);
    return { ip: Number(a ?? 0), total: Number(b ?? 0) };
  }
  async recordFailure(ip: string) {
    for (const key of [`${this.prefix}f:${ip}`, `${this.prefix}f:all`]) {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, ADMIN_LOCK_WINDOW_S);
    }
  }
  async clearFailures(ip: string) {
    await this.redis.del(`${this.prefix}f:${ip}`);
  }
}
