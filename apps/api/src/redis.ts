import { Redis } from "ioredis";

export function createRedis(url: string) {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: false,
    // Resolve both A and AAAA records (Railway's private network is IPv6).
    family: 0,
  });
}
