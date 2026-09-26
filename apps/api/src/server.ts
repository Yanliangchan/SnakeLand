import { buildApp } from "./app";
import { createDb } from "./db/client";
import { loadEnv } from "./env";
import { createRedis } from "./redis";

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const { app, dealer, crashDealer, maintenance } = await buildApp({ env, db, redis });

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

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  // Dual-stack "::" needs IPv6; fall back to IPv4 on hosts without it.
  if ((err as NodeJS.ErrnoException).code !== "EAFNOSUPPORT" || env.HOST !== "::") throw err;
  app.log.warn("IPv6 unavailable, listening on IPv4 only");
  await app.listen({ host: "0.0.0.0", port: env.PORT });
}
// Live game loops check for unfinished rounds, then sleep until someone opens the game.
// Only the instance holding each Redis lease actually advances rounds.
dealer.start();
crashDealer.start();
// Housekeeping (top-5 snapshot, purges) also runs on a single lease holder.
maintenance.start();
