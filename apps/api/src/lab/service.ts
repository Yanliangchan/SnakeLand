import { createHmac } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import {
  LAB_FLAG_RE,
  LAB_MAX_HINT_PENALTY,
  labRewardAfterHints,
  type AdminLabChallengeDTO,
  type AdminLabChallengeInput,
  type LabCategory,
  type LabChallengeDTO,
  type LabDifficulty,
  type LabFlagMode,
  type LabHint,
  type LabHintResultDTO,
  type LabHintView,
  type LabListDTO,
  type LabSubmitResultDTO,
} from "@snakeland/shared";
import type { Db, Tx } from "../db/client";
import { labChallenges, labHintUnlocks, labSolves } from "../db/schema";
import { GameError } from "../games/errors";
import type { SessionUser } from "../http/session";
import type { WalletService } from "../wallet/wallet-service";
import { flagsMatch, hashFlag, labSecret, playerFlag, renderTemplate } from "./flags";
import { WEAK_SECRETS } from "./jwt";
import { STARTER_PACK } from "./starter";

type Row = typeof labChallenges.$inferSelect;

/** Pages that serve a per-player flag live under /v1/lab/c/<slug>. */
export const LAB_ENDPOINT_SLUGS = {
  leakyHeader: "leaky-header",
  lounge: "admin-lounge",
  sqlLogin: "login-bypass",
  sqlSearch: "union-heist",
  ecb: "ecb-oracle",
} as const;

function mustPlay(user: SessionUser) {
  if (user.isAnonymous) throw new GameError(403, "SIGN_UP_REQUIRED", "Create a free account to play the Lab");
}

/** Total percent of the reward given up for the hints opened so far. */
const totalPenalty = (hints: LabHint[], opened: Set<number>) =>
  Math.min(
    LAB_MAX_HINT_PENALTY,
    hints.reduce((sum, h, i) => (opened.has(i) ? sum + h.penalty : sum), 0),
  );

export class LabService {
  private readonly secret: Buffer;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    authSecret: string,
  ) {
    this.secret = labSecret(authSecret);
  }

  /** Insert the starter challenges that don't exist yet. Edits made in /admin are kept. */
  async ensureStarterPack(): Promise<void> {
    await this.db
      .insert(labChallenges)
      .values(
        STARTER_PACK.map((c, i) => ({
          slug: c.slug,
          title: c.title,
          category: c.category,
          difficulty: c.difficulty,
          description: c.description,
          hints: c.hints,
          files: c.files,
          flagMode: "per_player" as const,
          reward: c.reward,
          published: true,
          sortOrder: i * 10,
        })),
      )
      .onConflictDoNothing({ target: labChallenges.slug });
  }

  flagFor(userId: string, slug: string): string {
    return playerFlag(this.secret, userId, slug);
  }

  private async published(slug: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(labChallenges)
      .where(and(eq(labChallenges.slug, slug), eq(labChallenges.published, true)));
    if (!row) throw new GameError(404, "CHALLENGE_NOT_FOUND", "Challenge not found");
    return row;
  }

  /** The hint indexes this player has opened for a set of challenges. */
  private async unlocksFor(userId: string, challengeIds: string[]): Promise<Map<string, Set<number>>> {
    const out = new Map<string, Set<number>>();
    if (challengeIds.length === 0) return out;
    const rows = await this.db
      .select({ id: labHintUnlocks.challengeId, i: labHintUnlocks.hintIndex })
      .from(labHintUnlocks)
      .where(and(eq(labHintUnlocks.userId, userId), inArray(labHintUnlocks.challengeId, challengeIds)));
    for (const r of rows) (out.get(r.id) ?? out.set(r.id, new Set()).get(r.id)!).add(r.i);
    return out;
  }

  /** A challenge as this player sees it: opened hints revealed, reward after penalties. */
  private view(row: Row, opened: Set<number>, solves: number, solved: boolean): LabChallengeDTO {
    const hints: LabHintView[] = row.hints.map((h, i) => ({
      penalty: h.penalty,
      // Solvers see every hint once done, so a write-up reads in full.
      text: solved || opened.has(i) ? h.text : null,
    }));
    return {
      slug: row.slug,
      title: row.title,
      category: row.category as LabCategory,
      difficulty: row.difficulty as LabDifficulty,
      description: row.description,
      hints,
      reward: row.reward,
      effectiveReward: labRewardAfterHints(row.reward, totalPenalty(row.hints, opened)),
      files: row.files.map((f) => ({ name: f.name })),
      solves,
      solved,
    };
  }

  async list(user: SessionUser): Promise<LabListDTO> {
    const rows = await this.db
      .select()
      .from(labChallenges)
      .where(eq(labChallenges.published, true))
      .orderBy(asc(labChallenges.sortOrder), asc(labChallenges.createdAt));
    const ids = rows.map((r) => r.id);
    const [solveCounts, mine, unlocks] = await Promise.all([
      this.db.select({ id: labSolves.challengeId, n: count() }).from(labSolves).groupBy(labSolves.challengeId),
      user.isAnonymous
        ? Promise.resolve([] as { id: string; reward: number }[])
        : this.db.select({ id: labSolves.challengeId, reward: labSolves.reward }).from(labSolves).where(eq(labSolves.userId, user.id)),
      user.isAnonymous ? Promise.resolve(new Map<string, Set<number>>()) : this.unlocksFor(user.id, ids),
    ]);
    const solves = new Map(solveCounts.map((s) => [s.id, s.n]));
    const solved = new Set(mine.map((m) => m.id));
    const challenges = rows.map((r) => this.view(r, unlocks.get(r.id) ?? new Set(), solves.get(r.id) ?? 0, solved.has(r.id)));
    return { challenges, earned: mine.reduce((a, m) => a + m.reward, 0), canPlay: !user.isAnonymous };
  }

  /** Open the next-cheapest unopened hint, or a specific one. Cuts the reward. */
  async unlockHint(user: SessionUser, slug: string, index: number): Promise<LabHintResultDTO> {
    mustPlay(user);
    const row = await this.published(slug);
    const hint = row.hints[index];
    if (!hint) throw new GameError(404, "HINT_NOT_FOUND", "No such hint");
    // Hints must be opened in order, so a player can't skip to the last one cheaply.
    for (let i = 0; i < index; i++) {
      const [prev] = await this.db
        .select({ id: labHintUnlocks.id })
        .from(labHintUnlocks)
        .where(and(eq(labHintUnlocks.userId, user.id), eq(labHintUnlocks.challengeId, row.id), eq(labHintUnlocks.hintIndex, i)));
      if (!prev) throw new GameError(409, "HINT_ORDER", "Open the earlier hint first");
    }
    await this.db
      .insert(labHintUnlocks)
      .values({ userId: user.id, challengeId: row.id, hintIndex: index })
      .onConflictDoNothing();
    const opened = (await this.unlocksFor(user.id, [row.id])).get(row.id) ?? new Set<number>();
    return { text: hint.text, effectiveReward: labRewardAfterHints(row.reward, totalPenalty(row.hints, opened)) };
  }

  /** One attachment, filled in for this player. */
  async file(user: SessionUser, slug: string, index: number): Promise<{ name: string; content: string }> {
    mustPlay(user);
    const row = await this.published(slug);
    const f = row.files[index];
    if (!f) throw new GameError(404, "FILE_NOT_FOUND", "File not found");
    const content = row.flagMode === "per_player" ? renderTemplate(f.content, this.secret, user.id, row.slug) : f.content;
    return { name: f.name, content };
  }

  async submit(user: SessionUser, slug: string, submitted: string): Promise<LabSubmitResultDTO> {
    mustPlay(user);
    const flag = submitted.trim();
    const row = await this.published(slug);
    const miss: LabSubmitResultDTO = { correct: false, reward: null, balance: null, alreadySolved: false };
    if (!LAB_FLAG_RE.test(flag)) return miss;
    const expected = row.flagMode === "per_player" ? hashFlag(this.flagFor(user.id, row.slug)) : row.flagHash!;
    if (!flagsMatch(flag, expected)) return miss;

    return this.db.transaction(async (tx) => {
      // Reward is fixed at solve time from the hints opened by then.
      const opened = await this.openedInTx(tx, user.id, row.id);
      const reward = labRewardAfterHints(row.reward, totalPenalty(row.hints, opened));
      const [solve] = await tx
        .insert(labSolves)
        .values({ userId: user.id, challengeId: row.id, reward })
        .onConflictDoNothing()
        .returning({ id: labSolves.id });
      if (!solve) return { correct: true, reward: null, balance: null, alreadySolved: true };
      const credit = await this.wallet.apply(
        { userId: user.id, amount: reward, type: "lab_reward", idempotencyKey: `lab:${row.id}`, meta: { challenge: row.slug } },
        tx,
      );
      return { correct: true, reward, balance: credit.balance, alreadySolved: false };
    });
  }

  private async openedInTx(tx: Tx, userId: string, challengeId: string): Promise<Set<number>> {
    const rows = await tx
      .select({ i: labHintUnlocks.hintIndex })
      .from(labHintUnlocks)
      .where(and(eq(labHintUnlocks.userId, userId), eq(labHintUnlocks.challengeId, challengeId)));
    return new Set(rows.map((r) => r.i));
  }

  /** The endpoint challenges only answer while they're published. */
  async endpointFlag(user: SessionUser, slug: string): Promise<string> {
    mustPlay(user);
    const row = await this.published(slug);
    return this.flagFor(user.id, row.slug);
  }

  /** A per-player secret derived from the lab key, for the JWT and AES challenges. */
  private derive(userId: string, slug: string, label: string): Buffer {
    return createHmac("sha256", this.secret).update(`${label}:${userId}:${slug}`).digest();
  }

  /** The flag plus per-player crypto material for an endpoint challenge (publish-checked). */
  async endpointContext(user: SessionUser, slug: string): Promise<{ flag: string; aesKey: Buffer; jwtSecret: string }> {
    mustPlay(user);
    const row = await this.published(slug);
    const flag = this.flagFor(user.id, row.slug);
    const aesKey = this.derive(user.id, row.slug, "aes").subarray(0, 16);
    const jwtSecret = WEAK_SECRETS[this.derive(user.id, row.slug, "jwt").readUInt32BE(0) % WEAK_SECRETS.length]!;
    return { flag, aesKey, jwtSecret };
  }

  // ------------------------------------------------------------------ admin

  async adminList(): Promise<AdminLabChallengeDTO[]> {
    const rows = await this.db
      .select({
        c: labChallenges,
        solves: sql<number>`(SELECT count(*)::int FROM lab_solves s WHERE s.challenge_id = ${labChallenges.id})`,
      })
      .from(labChallenges)
      .orderBy(asc(labChallenges.sortOrder), asc(labChallenges.createdAt));
    return rows.map(({ c, solves }) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      category: c.category as LabCategory,
      difficulty: c.difficulty as LabDifficulty,
      description: c.description,
      reward: c.reward,
      flagMode: c.flagMode as LabFlagMode,
      hasStaticFlag: c.flagHash !== null,
      files: c.files,
      hints: c.hints,
      published: c.published,
      sortOrder: c.sortOrder,
      solves,
    }));
  }

  private values(input: AdminLabChallengeInput) {
    const flag = input.flag?.trim();
    if (flag && !LAB_FLAG_RE.test(flag)) throw new GameError(400, "INVALID_FLAG", "Flags look like snk{...}");
    return {
      slug: input.slug,
      title: input.title,
      category: input.category,
      difficulty: input.difficulty,
      description: input.description,
      hints: input.hints,
      reward: input.reward,
      flagMode: input.flagMode,
      files: input.files,
      published: input.published,
      sortOrder: input.sortOrder,
      ...(flag ? { flagHash: hashFlag(flag) } : {}),
    };
  }

  private conflict(e: unknown): never {
    if ((e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      throw new GameError(409, "SLUG_TAKEN", "Another challenge uses that slug");
    }
    throw e;
  }

  async create(input: AdminLabChallengeInput): Promise<string> {
    if (input.flagMode === "static" && !input.flag) throw new GameError(400, "FLAG_REQUIRED", "Set the flag");
    try {
      const [row] = await this.db.insert(labChallenges).values(this.values(input)).returning({ id: labChallenges.id });
      return row!.id;
    } catch (e) {
      this.conflict(e);
    }
  }

  async update(id: string, input: AdminLabChallengeInput): Promise<void> {
    const [current] = await this.db.select().from(labChallenges).where(eq(labChallenges.id, id));
    if (!current) throw new GameError(404, "CHALLENGE_NOT_FOUND", "Challenge not found");
    if (input.flagMode === "static" && !input.flag && !current.flagHash) throw new GameError(400, "FLAG_REQUIRED", "Set the flag");
    try {
      await this.db.update(labChallenges).set(this.values(input)).where(eq(labChallenges.id, id));
    } catch (e) {
      this.conflict(e);
    }
  }

  /** Solved challenges keep their history: unpublish those instead. */
  async remove(id: string): Promise<void> {
    const [solved] = await this.db.select({ n: count() }).from(labSolves).where(eq(labSolves.challengeId, id));
    if (solved!.n > 0) throw new GameError(409, "HAS_SOLVES", "Players have solved this one. Unpublish it instead");
    await this.db.delete(labHintUnlocks).where(eq(labHintUnlocks.challengeId, id));
    const gone = await this.db.delete(labChallenges).where(eq(labChallenges.id, id)).returning({ id: labChallenges.id });
    if (!gone.length) throw new GameError(404, "CHALLENGE_NOT_FOUND", "Challenge not found");
  }
}
