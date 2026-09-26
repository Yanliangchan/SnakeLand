import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { LiveRoom } from "@snakeland/shared";

/** Viewers per live room. Missing rooms mean zero. */
export type RoomCounts = Partial<Record<LiveRoom, number>>;

const STALE_MS = 15_000;

/** How many sockets sit in each live room, summed across API instances. */
export interface Presence {
  readonly instanceId: string;
  report(counts: RoomCounts): Promise<void>;
  totals(): Promise<RoomCounts>;
}

function add(into: RoomCounts, counts: RoomCounts) {
  for (const [room, n] of Object.entries(counts) as Array<[LiveRoom, number]>) into[room] = (into[room] ?? 0) + n;
}

export class MemoryPresence implements Presence {
  readonly instanceId = randomUUID();
  private byInstance = new Map<string, { counts: RoomCounts; at: number }>();
  async report(counts: RoomCounts) {
    this.byInstance.set(this.instanceId, { counts, at: Date.now() });
  }
  /** Tests can pretend other instances have viewers (`pinned` never goes stale). */
  set(instance: string, counts: RoomCounts, pinned = false) {
    this.byInstance.set(instance, { counts, at: pinned ? Number.MAX_SAFE_INTEGER : Date.now() });
  }
  async totals() {
    const out: RoomCounts = {};
    for (const { counts, at } of this.byInstance.values()) if (Date.now() - at <= STALE_MS) add(out, counts);
    return out;
  }
}

/** One hash field per instance, refreshed while it has sockets; dead instances age out. */
export class RedisPresence implements Presence {
  readonly instanceId = randomUUID();
  constructor(
    private readonly redis: Redis,
    private readonly key = "snk:presence",
  ) {}
  async report(counts: RoomCounts) {
    const empty = Object.values(counts).every((n) => !n);
    // An instance with nobody connected removes itself instead of writing zeros.
    if (empty) await this.redis.hdel(this.key, this.instanceId).catch(() => {});
    else await this.redis.hset(this.key, this.instanceId, JSON.stringify({ counts, at: Date.now() })).catch(() => {});
  }
  async totals() {
    const out: RoomCounts = {};
    const all = await this.redis.hgetall(this.key).catch(() => ({}) as Record<string, string>);
    const stale: string[] = [];
    for (const [field, raw] of Object.entries(all)) {
      try {
        const { counts, at } = JSON.parse(raw) as { counts: RoomCounts; at: number };
        if (Date.now() - at > STALE_MS) stale.push(field);
        else add(out, counts);
      } catch {
        stale.push(field);
      }
    }
    if (stale.length) await this.redis.hdel(this.key, ...stale).catch(() => {});
    return out;
  }
}
