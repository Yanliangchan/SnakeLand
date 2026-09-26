import type { Redis } from "ioredis";

/** Cross-instance fan-out. Every API instance receives every message. */
export interface Bus {
  publish(message: unknown): Promise<void>;
  subscribe(handler: (message: unknown) => void): () => void;
  close(): Promise<void>;
}

export class MemoryBus implements Bus {
  private handlers = new Set<(m: unknown) => void>();
  async publish(message: unknown) {
    // Round-trip through JSON so behaviour matches the Redis bus.
    const copy: unknown = JSON.parse(JSON.stringify(message));
    for (const h of this.handlers) h(copy);
  }
  subscribe(handler: (m: unknown) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  async close() {
    this.handlers.clear();
  }
}

export class RedisBus implements Bus {
  private readonly sub: Redis;
  private handlers = new Set<(m: unknown) => void>();

  constructor(
    private readonly pub: Redis,
    private readonly channel: string,
  ) {
    // A subscribed connection can't run other commands, so use a dedicated one.
    // Unlike the command client it queues while connecting, and ioredis
    // re-subscribes automatically after a reconnect.
    this.sub = pub.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
    this.sub.on("error", () => {});
    this.sub.subscribe(channel).catch(() => {
      // Retried by ioredis on reconnect (autoResubscribe).
    });
    this.sub.on("message", (ch: string, raw: string) => {
      if (ch !== channel) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      for (const h of this.handlers) h(parsed);
    });
  }

  async publish(message: unknown) {
    await this.pub.publish(this.channel, JSON.stringify(message));
  }
  subscribe(handler: (m: unknown) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  async close() {
    this.handlers.clear();
    this.sub.disconnect();
  }
}
