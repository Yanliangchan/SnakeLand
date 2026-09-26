import { afterAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RedisBus } from "../src/realtime/bus";
import { RedisLeadership } from "../src/realtime/leader";

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
const available = await redis.connect().then(
  () => true,
  () => false,
);
afterAll(() => redis.disconnect());

describe.runIf(available)("realtime over Redis", () => {
  it("elects exactly one leader and hands over when it releases", async () => {
    const key = `test:leader:${crypto.randomUUID()}`;
    const a = new RedisLeadership(redis, key, 1_000);
    const b = new RedisLeadership(redis, key, 1_000);
    const [la, lb] = await Promise.all([a.isLeader(), b.isLeader()]);
    expect([la, lb].filter(Boolean)).toHaveLength(1);
    const [leader, follower] = la ? [a, b] : [b, a];
    await leader.release();
    await new Promise((r) => setTimeout(r, 250));
    expect(await follower.isLeader()).toBe(true);
    await follower.release();
  });

  it("fans a message out to every subscriber instance", async () => {
    const channel = `test:bus:${crypto.randomUUID()}`;
    const one = new RedisBus(redis, channel);
    const two = new RedisBus(redis, channel);
    const got: unknown[] = [];
    one.subscribe((m) => got.push(["one", m]));
    two.subscribe((m) => got.push(["two", m]));
    await new Promise((r) => setTimeout(r, 150));
    await one.publish({ hello: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toEqual(expect.arrayContaining([["one", { hello: 1 }], ["two", { hello: 1 }]]));
    await one.close();
    await two.close();
  });
});
