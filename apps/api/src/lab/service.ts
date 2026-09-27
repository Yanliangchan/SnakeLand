import { and, asc, count, eq, sql } from "drizzle-orm";
import {
  LAB_FLAG_RE,
  type AdminLabChallengeDTO,
  type AdminLabChallengeInput,
  type LabCategory,
  type LabChallengeDTO,
  type LabDifficulty,
  type LabFlagMode,
  type LabListDTO,
  type LabSubmitResultDTO,
} from "@snakeland/shared";
import type { Db } from "../db/client";
import { labChallenges, labSolves } from "../db/schema";
import { GameError } from "../games/errors";
import type { SessionUser } from "../http/session";
import type { WalletService } from "../wallet/wallet-service";
import {
  flagsMatch,
  hashFlag,
  labSecret,
  playerFlag,
  renderTemplate,
} from "./flags";
import { STARTER_PACK, starterReward } from "./starter";

type Row = typeof labChallenges.$inferSelect;

/** Pages that serve a per-player flag live under /v1/lab/c/<slug>. */
export const LAB_ENDPOINT_SLUGS = {
  status: "leaky-header",
  vip: "vip-room",
} as const;

function mustPlay(user: SessionUser) {
  if (user.isAnonymous)
    throw new GameError(
      403,
      "SIGN_UP_REQUIRED",
      "Create a free account to play the Lab",
    );
}

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
          hint: c.hint,
          files: c.files,
          flagMode: "per_player",
          reward: starterReward(c.difficulty),
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
      .where(
        and(eq(labChallenges.slug, slug), eq(labChallenges.published, true)),
      );
    if (!row)
      throw new GameError(404, "CHALLENGE_NOT_FOUND", "Challenge not found");
    return row;
  }

  async list(user: SessionUser): Promise<LabListDTO> {
    const [rows, solveCounts, mine] = await Promise.all([
      this.db
        .select()
        .from(labChallenges)
        .where(eq(labChallenges.published, true))
        .orderBy(asc(labChallenges.sortOrder), asc(labChallenges.createdAt)),
      this.db
        .select({ id: labSolves.challengeId, n: count() })
        .from(labSolves)
        .groupBy(labSolves.challengeId),
      this.db
        .select({ id: labSolves.challengeId, reward: labSolves.reward })
        .from(labSolves)
        .where(eq(labSolves.userId, user.id)),
    ]);
    const solves = new Map(solveCounts.map((s) => [s.id, s.n]));
    const solved = new Set(mine.map((m) => m.id));
    const challenges: LabChallengeDTO[] = rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      category: r.category as LabCategory,
      difficulty: r.difficulty as LabDifficulty,
      description: r.description,
      hint: r.hint,
      reward: r.reward,
      files: r.files.map((f) => ({ name: f.name })),
      solves: solves.get(r.id) ?? 0,
      solved: solved.has(r.id),
    }));
    return {
      challenges,
      earned: mine.reduce((a, m) => a + m.reward, 0),
      canPlay: !user.isAnonymous,
    };
  }

  /** One attachment, filled in for this player. */
  async file(
    user: SessionUser,
    slug: string,
    index: number,
  ): Promise<{ name: string; content: string }> {
    mustPlay(user);
    const row = await this.published(slug);
    const f = row.files[index];
    if (!f) throw new GameError(404, "FILE_NOT_FOUND", "File not found");
    const content =
      row.flagMode === "per_player"
        ? renderTemplate(f.content, this.secret, user.id, row.slug)
        : f.content;
    return { name: f.name, content };
  }

  async submit(
    user: SessionUser,
    slug: string,
    submitted: string,
  ): Promise<LabSubmitResultDTO> {
    mustPlay(user);
    const flag = submitted.trim();
    const row = await this.published(slug);
    if (!LAB_FLAG_RE.test(flag))
      return {
        correct: false,
        reward: null,
        balance: null,
        alreadySolved: false,
      };
    const expected =
      row.flagMode === "per_player"
        ? hashFlag(this.flagFor(user.id, row.slug))
        : row.flagHash!;
    if (!flagsMatch(flag, expected))
      return {
        correct: false,
        reward: null,
        balance: null,
        alreadySolved: false,
      };

    return this.db.transaction(async (tx) => {
      const [solve] = await tx
        .insert(labSolves)
        .values({ userId: user.id, challengeId: row.id, reward: row.reward })
        .onConflictDoNothing()
        .returning({ id: labSolves.id });
      if (!solve)
        return {
          correct: true,
          reward: null,
          balance: null,
          alreadySolved: true,
        };
      const credit = await this.wallet.apply(
        {
          userId: user.id,
          amount: row.reward,
          type: "lab_reward",
          idempotencyKey: `lab:${row.id}`,
          meta: { challenge: row.slug },
        },
        tx,
      );
      return {
        correct: true,
        reward: row.reward,
        balance: credit.balance,
        alreadySolved: false,
      };
    });
  }

  /** The endpoint challenges only answer while they're published. */
  async endpointFlag(user: SessionUser, slug: string): Promise<string> {
    mustPlay(user);
    const row = await this.published(slug);
    return this.flagFor(user.id, row.slug);
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
      hint: c.hint,
      reward: c.reward,
      flagMode: c.flagMode as LabFlagMode,
      hasStaticFlag: c.flagHash !== null,
      files: c.files,
      published: c.published,
      sortOrder: c.sortOrder,
      solves,
    }));
  }

  private values(input: AdminLabChallengeInput) {
    const flag = input.flag?.trim();
    if (flag && !LAB_FLAG_RE.test(flag))
      throw new GameError(400, "INVALID_FLAG", "Flags look like snk{...}");
    return {
      slug: input.slug,
      title: input.title,
      category: input.category,
      difficulty: input.difficulty,
      description: input.description,
      hint: input.hint || null,
      reward: input.reward,
      flagMode: input.flagMode,
      files: input.files,
      published: input.published,
      sortOrder: input.sortOrder,
      ...(flag ? { flagHash: hashFlag(flag) } : {}),
    };
  }

  async create(input: AdminLabChallengeInput): Promise<string> {
    if (input.flagMode === "static" && !input.flag)
      throw new GameError(400, "FLAG_REQUIRED", "Set the flag");
    try {
      const [row] = await this.db
        .insert(labChallenges)
        .values(this.values(input))
        .returning({ id: labChallenges.id });
      return row!.id;
    } catch (e) {
      if (
        (e as { code?: string }).code === "23505" ||
        (e as { cause?: { code?: string } }).cause?.code === "23505"
      ) {
        throw new GameError(
          409,
          "SLUG_TAKEN",
          "Another challenge uses that slug",
        );
      }
      throw e;
    }
  }

  async update(id: string, input: AdminLabChallengeInput): Promise<void> {
    const [current] = await this.db
      .select()
      .from(labChallenges)
      .where(eq(labChallenges.id, id));
    if (!current)
      throw new GameError(404, "CHALLENGE_NOT_FOUND", "Challenge not found");
    if (input.flagMode === "static" && !input.flag && !current.flagHash)
      throw new GameError(400, "FLAG_REQUIRED", "Set the flag");
    try {
      await this.db
        .update(labChallenges)
        .set(this.values(input))
        .where(eq(labChallenges.id, id));
    } catch (e) {
      if (
        (e as { code?: string }).code === "23505" ||
        (e as { cause?: { code?: string } }).cause?.code === "23505"
      ) {
        throw new GameError(
          409,
          "SLUG_TAKEN",
          "Another challenge uses that slug",
        );
      }
      throw e;
    }
  }

  /** Solved challenges keep their history: unpublish those instead. */
  async remove(id: string): Promise<void> {
    const [solved] = await this.db
      .select({ n: count() })
      .from(labSolves)
      .where(eq(labSolves.challengeId, id));
    if (solved!.n > 0)
      throw new GameError(
        409,
        "HAS_SOLVES",
        "Players have solved this one. Unpublish it instead",
      );
    const gone = await this.db
      .delete(labChallenges)
      .where(eq(labChallenges.id, id))
      .returning({ id: labChallenges.id });
    if (!gone.length)
      throw new GameError(404, "CHALLENGE_NOT_FOUND", "Challenge not found");
  }
}
