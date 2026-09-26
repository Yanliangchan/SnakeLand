import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/** Decides which single instance drives shared game loops. */
export interface Leadership {
  isLeader(): Promise<boolean>;
  release(): Promise<void>;
}

export class AlwaysLeader implements Leadership {
  async isLeader() {
    return true;
  }
  async release() {}
}

// Extend the lease only if we still own it.
const RENEW = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Lease-based leader election on one Redis key. A leader that dies stops
 * renewing and another instance takes over within `ttlMs`. The game loop is
 * stateless between ticks (state lives in Postgres), so takeover is safe.
 */
export class RedisLeadership implements Leadership {
  private readonly id = randomUUID();
  private lastCheck = 0;
  private leader = false;

  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly ttlMs = 5_000,
  ) {}

  async isLeader(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastCheck < this.ttlMs / 5) return this.leader;
    this.lastCheck = now;
    try {
      if (this.leader) {
        this.leader = (await this.redis.eval(RENEW, 1, this.key, this.id, String(this.ttlMs))) === 1;
      }
      if (!this.leader) {
        this.leader = (await this.redis.set(this.key, this.id, "PX", this.ttlMs, "NX")) === "OK";
      }
    } catch {
      this.leader = false;
    }
    return this.leader;
  }

  async release() {
    if (this.leader) await this.redis.eval(RELEASE, 1, this.key, this.id).catch(() => {});
    this.leader = false;
  }
}
