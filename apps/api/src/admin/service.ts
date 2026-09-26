import { and, desc, eq, gt, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  weekKey,
  type AdminAuditDTO,
  type AdminPlayerDetailDTO,
  type AdminPlayerPageDTO,
  type AdminStatsDTO,
} from "@snakeland/shared";
import { sanitizeDisplayName } from "../auth";
import type { Db } from "../db/client";
import { adminAudit, sessions, users } from "../db/schema";
import { GameError } from "../games/errors";
import type { ProgressService } from "../progress/service";
import { walletStatsTable } from "../progress/tables";
import type { WalletService } from "../wallet/wallet-service";

export type PlayerFilter = "all" | "players" | "guests" | "suspended";

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(raw, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Read and account-level operations for the admin console. Money goes through WalletService. */
export class AdminService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly progress: ProgressService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private notFound(): never {
    throw new GameError(404, "PLAYER_NOT_FOUND", "Player not found");
  }

  /** Drop cached leaderboards after an account-level change. */
  invalidate() {
    this.progress.invalidate();
  }

  async audit(action: string, targetUserId: string | null, detail: Record<string, unknown> | null, ip: string) {
    await this.db.insert(adminAudit).values({ action, targetUserId, detail, ip });
  }

  async stats(): Promise<AdminStatsDTO> {
    const since = new Date(this.clock().getTime() - 86_400_000);
    const [row] = await this.db
      .select({
        players: sql<number>`count(*) FILTER (WHERE NOT ${users.isAnonymous})::int`,
        guests: sql<number>`count(*) FILTER (WHERE ${users.isAnonymous})::int`,
        suspended: sql<number>`count(*) FILTER (WHERE ${users.suspendedAt} IS NOT NULL)::int`,
        chips: sql<string>`coalesce(sum(${walletStatsTable.balance}), 0)`,
      })
      .from(users)
      .leftJoin(walletStatsTable, eq(walletStatsTable.userId, users.id));
    const [active] = await this.db
      .select({ n: sql<number>`count(DISTINCT ${sessions.userId})::int` })
      .from(sessions)
      .where(gt(sessions.updatedAt, since));
    return {
      players: row?.players ?? 0,
      guests: row?.guests ?? 0,
      suspended: row?.suspended ?? 0,
      chipsInPlay: Number(row?.chips ?? 0),
      activeToday: active?.n ?? 0,
    };
  }

  async list(opts: { q?: string; filter: PlayerFilter; cursor?: string; limit: number }): Promise<AdminPlayerPageDTO> {
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !cursor) throw new GameError(400, "INVALID_CURSOR", "Invalid cursor");
    const conditions: Array<SQL | undefined> = [];
    const q = opts.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      conditions.push(or(ilike(users.name, like), ilike(users.email, like), eq(users.id, q)));
    }
    if (opts.filter === "players") conditions.push(eq(users.isAnonymous, false));
    if (opts.filter === "guests") conditions.push(eq(users.isAnonymous, true));
    if (opts.filter === "suspended") conditions.push(isNotNull(users.suspendedAt));
    const filterWhere = and(...conditions);
    const pageWhere = and(
      filterWhere,
      cursor
        ? or(lt(users.createdAt, cursor.createdAt), and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)))
        : undefined,
    );

    const w = walletStatsTable;
    const wk = weekKey(this.clock());
    const lastSeen = sql<Date | null>`(SELECT max(${sessions.updatedAt}) FROM ${sessions} WHERE ${sessions.userId} = ${users.id})`;
    const [rows, [count]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          isGuest: users.isAnonymous,
          suspendedAt: users.suspendedAt,
          createdAt: users.createdAt,
          balance: w.balance,
          lifetimeProfit: w.lifetimeProfit,
          weekKey: w.weekKey,
          weekProfit: w.weekProfit,
          lastSeen,
        })
        .from(users)
        .leftJoin(w, eq(w.userId, users.id))
        .where(pageWhere)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(opts.limit + 1),
      this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(filterWhere),
    ]);
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      total: count?.n ?? 0,
      nextCursor: rows.length > opts.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      items: page.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.isGuest ? null : r.email,
        isGuest: r.isGuest,
        suspended: r.suspendedAt !== null,
        balance: r.balance ?? 0,
        allTimeProfit: r.lifetimeProfit ?? 0,
        weeklyProfit: r.weekKey === wk ? (r.weekProfit ?? 0) : 0,
        joinedAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
      })),
    };
  }

  private async user(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    return u ?? this.notFound();
  }

  async detail(userId: string): Promise<AdminPlayerDetailDTO> {
    const u = await this.user(userId);
    const now = this.clock();
    const [profile, sess, txs, audit] = await Promise.all([
      this.progress.profile(userId),
      this.db
        .select({
          active: sql<number>`count(*) FILTER (WHERE ${sessions.expiresAt} > ${now})::int`,
          last: sql<Date | null>`max(${sessions.updatedAt})`,
        })
        .from(sessions)
        .where(eq(sessions.userId, userId)),
      this.wallet.listTransactions(userId, { limit: 50 }),
      this.db
        .select()
        .from(adminAudit)
        .where(eq(adminAudit.targetUserId, userId))
        .orderBy(desc(adminAudit.createdAt))
        .limit(25),
    ]);
    return {
      profile,
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
      activeSessions: sess[0]?.active ?? 0,
      lastSeenAt: sess[0]?.last ? new Date(sess[0].last).toISOString() : null,
      transactions: txs.items,
      audit: audit.map(
        (a): AdminAuditDTO => ({ id: a.id, action: a.action, detail: a.detail ?? null, createdAt: a.createdAt.toISOString() }),
      ),
    };
  }

  async rename(userId: string, raw: string) {
    let name: string;
    try {
      name = sanitizeDisplayName(raw);
    } catch {
      throw new GameError(400, "INVALID_NAME", "Name must be 1–32 characters");
    }
    const [row] = await this.db.update(users).set({ name }).where(eq(users.id, userId)).returning({ old: users.id });
    if (!row) this.notFound();
    this.progress.invalidate();
    return name;
  }

  /** Suspending also signs the player out everywhere; the auth hook blocks new sessions. */
  async setSuspended(userId: string, suspended: boolean) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ suspendedAt: suspended ? this.clock() : null })
        .where(and(eq(users.id, userId), suspended ? isNull(users.suspendedAt) : isNotNull(users.suspendedAt)))
        .returning({ id: users.id });
      if (!row) await this.user(userId);
      if (suspended) await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
    this.progress.invalidate();
  }

  async signOutEverywhere(userId: string): Promise<number> {
    await this.user(userId);
    const removed = await this.db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    return removed.length;
  }
}
