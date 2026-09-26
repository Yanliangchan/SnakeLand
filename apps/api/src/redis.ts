import { Redis } from "ioredis";

export function createRedis(url: string) {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
}
