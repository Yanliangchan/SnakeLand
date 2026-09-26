import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashServerSeed } from "@snakeland/shared";
import type { Db, DbOrTx, Tx } from "../db/client";
import { fairSeeds } from "../db/schema";

export const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

const newSeed = () => {
  const serverSeed = randomBytes(32).toString("hex");
  return { nextServerSeed: serverSeed, nextServerSeedHash: hashServerSeed(serverSeed) };
};

/**
 * Per-round commit–reveal for instant games. Each user always has one
 * pre-committed "next" server seed whose hash they can see before betting.
 * Starting a round consumes it (under a row lock, so concurrent rounds never
 * share a seed) and immediately commits a fresh one for the round after.
 */
export class FairSeedService {
  constructor(private readonly db: Db) {}

  private async ensure(tx: DbOrTx, userId: string) {
    await tx.insert(fairSeeds).values({ userId, ...newSeed() }).onConflictDoNothing({ target: fairSeeds.userId });
  }

  /** The commit for the user's next round. */
  async nextCommit(userId: string, tx?: DbOrTx): Promise<string> {
    const q = tx ?? this.db;
    await this.ensure(q, userId);
    const [row] = await q
      .select({ hash: fairSeeds.nextServerSeedHash })
      .from(fairSeeds)
      .where(eq(fairSeeds.userId, userId));
    return row!.hash;
  }

  /** Take the committed seed for a new round and commit its successor. */
  async consume(tx: Tx, userId: string): Promise<{ serverSeed: string; commit: string; nextCommit: string }> {
    await this.ensure(tx, userId);
    const [row] = await tx.select().from(fairSeeds).where(eq(fairSeeds.userId, userId)).for("update");
    const next = newSeed();
    await tx.update(fairSeeds).set(next).where(eq(fairSeeds.userId, userId));
    return { serverSeed: row!.nextServerSeed, commit: row!.nextServerSeedHash, nextCommit: next.nextServerSeedHash };
  }
}
