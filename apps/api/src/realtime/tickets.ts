import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Single-use, short-lived tickets that let a browser open the live-game
 * WebSocket without a cookie (the cookie lives on the web origin, which
 * proxies REST). The ticket is minted through that proxy with the session
 * cookie, then presented once on the WebSocket URL.
 */
export interface TicketStore {
  issue(userId: string): Promise<string>;
  /** Returns the user id and deletes the ticket, or null if unknown/expired/used. */
  redeem(ticket: string): Promise<string | null>;
}

const TTL_MS = 30_000;
const TICKET_RE = /^[A-Za-z0-9_-]{43}$/;
const newTicket = () => randomBytes(32).toString("base64url");

export class RedisTicketStore implements TicketStore {
  constructor(private readonly redis: Redis) {}
  async issue(userId: string) {
    const t = newTicket();
    await this.redis.set(`snk:wst:${t}`, userId, "PX", TTL_MS);
    return t;
  }
  async redeem(ticket: string) {
    if (!TICKET_RE.test(ticket)) return null;
    return this.redis.getdel(`snk:wst:${ticket}`);
  }
}

export class MemoryTicketStore implements TicketStore {
  private tickets = new Map<string, { userId: string; expires: number }>();
  async issue(userId: string) {
    const t = newTicket();
    this.tickets.set(t, { userId, expires: Date.now() + TTL_MS });
    return t;
  }
  async redeem(ticket: string) {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return entry && entry.expires > Date.now() ? entry.userId : null;
  }
}
