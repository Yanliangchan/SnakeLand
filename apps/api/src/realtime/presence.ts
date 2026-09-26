import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { ROULETTE_WHEELS, type WheelId } from "@snakeland/shared";

export type WheelCounts = Record<WheelId, number>;
export const emptyCounts = (): WheelCounts =>
  Object.fromEntries(ROULETTE_WHEELS.map((w) => [w.id, 0])) as WheelCounts;

const STALE_MS = 15_000;

/** How many sockets watch each wheel, summed across API instances. */
export interface Presence {
  readonly instanceId: string;
  report(counts: WheelCounts): Promise<void>;
  totals(): Promise<WheelCounts>;
}

export class MemoryPresence implements Presence {
  readonly instanceId = randomUUID();
  private byInstance = new Map<string, { counts: WheelCounts; at: number }>();
  async report(counts: WheelCounts) {
    this.byInstance.set(this.instanceId, { counts, at: Date.now() });
  }
  /** Tests can pretend other instances have viewers (`pinned` never goes stale). */
  set(instance: string, counts: Partial<WheelCounts>, pinned = false) {
    this.byInstance.set(instance, { counts: { ...emptyCounts(), ...counts }, at: pinned ? Number.MAX_SAFE_INTEGER : Date.now() });
  }
  async totals() {
    const out = emptyCounts();
    for (const { counts, at } of this.byInstance.values()) {
      if (Date.now() - at > STALE_MS) continue;
      for (const k of Object.keys(out) as WheelId[]) out[k] += counts[k] ?? 0;
    }
    return out;
  }
}

/** One hash field per instance, refreshed every few seconds; dead instances age out. */
export class RedisPresence implements Presence {
  readonly instanceId = randomUUID();
  constructor(
    private readonly redis: Redis,
    private readonly key = "snk:presence",
  ) {}
  async report(counts: WheelCounts) {
    await this.redis.hset(this.key, this.instanceId, JSON.stringify({ counts, at: Date.now() })).catch(() => {});
  }
  async totals() {
    const out = emptyCounts();
    const all = await this.redis.hgetall(this.key).catch(() => ({}) as Record<string, string>);
    const stale: string[] = [];
    for (const [field, raw] of Object.entries(all)) {
      try {
        const { counts, at } = JSON.parse(raw) as { counts: WheelCounts; at: number };
        if (Date.now() - at > STALE_MS) {
          stale.push(field);
          continue;
        }
        for (const k of Object.keys(out) as WheelId[]) out[k] += counts[k] ?? 0;
      } catch {
        stale.push(field);
      }
    }
    if (stale.length) await this.redis.hdel(this.key, ...stale).catch(() => {});
    return out;
  }
}
