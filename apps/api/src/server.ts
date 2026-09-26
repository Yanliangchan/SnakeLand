import { buildApp } from "./app";
import { createDb } from "./db/client";
import { loadEnv } from "./env";
import { createRedis } from "./redis";

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const { app, dealer } = await buildApp({ env, db, redis });

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await pool.end();
    redis.disconnect();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: env.HOST, port: env.PORT });
// Only the instance holding the Redis lease actually advances the wheels.
dealer.start();
