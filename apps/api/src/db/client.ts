import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schema } from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Small pool: the API is one modest instance, and Postgres memory scales with connections.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against runaway queries holding row locks on wallets.
    statement_timeout: 10_000,
  });
  const db: Db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}
