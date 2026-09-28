import { and, desc, eq, gt, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  weekKey,
  type AdminAuditDTO,
  type AdminOverviewDTO,
  type AdminPlayerDetailDTO,
  type AdminPlayerPageDTO,
  type AdminStatsDTO,
} from "@snakeland/shared";
import { sanitizeDisplayName } from "../auth";
import type { Db } from "../db/client";
import { adminAudit, events, sessions, users } from "../db/schema";
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

const roomsList = (rooms: Record<string, number>) =>
  Object.entries(rooms)
    .map(([room, viewers]) => ({ room, viewers }))
    .sort((a, b) => a.room.localeCompare(b.room));

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

  private overviewCache: { at: number; data: AdminOverviewDTO } | null = null;

  /**
   * Dashboard numbers. The ledger is read by table name (WalletService owns
   * the table objects). Cached briefly: it scans the last two weeks of rows.
   */
  async overview(liveRooms: Record<string, number>): Promise<AdminOverviewDTO> {
    const now = this.clock();
    if (this.overviewCache && now.getTime() - this.overviewCache.at < 30_000) {
      return { ...this.overviewCache.data, liveRooms: roomsList(liveRooms) };
    }
    const d1 = new Date(now.getTime() - 86_400_000);
    const d7 = new Date(now.getTime() - 7 * 86_400_000);
    const d14 = new Date(now.getTime() - 13 * 86_400_000);
    const GAME = sql.raw(`('bet', 'payout', 'refund')`);

    const [stats, day24, signups, days, games, flows, nets, auditRows, liveEvents] = await Promise.all([
      this.stats(),
      this.db.execute<{ wagered: string; net: string; rounds: number; active: number }>(sql`
        SELECT coalesce(sum(-amount) FILTER (WHERE type IN ('bet', 'refund')), 0) AS wagered,
               coalesce(sum(-amount) FILTER (WHERE type IN ${GAME}), 0) AS net,
               count(DISTINCT round_id) FILTER (WHERE type = 'bet')::int AS rounds,
               count(DISTINCT user_id)::int AS active
        FROM transactions WHERE created_at >= ${d1}`),
      this.db.execute<{ d1: number; d7: number }>(sql`
        SELECT count(*) FILTER (WHERE created_at >= ${d1})::int AS d1, count(*)::int AS d7
        FROM users WHERE NOT is_anonymous AND created_at >= ${d7}`),
      this.db.execute<{ day: string; signups: number; active: number; wagered: string; net: string }>(sql`
        WITH days AS (
          SELECT generate_series(date_trunc('day', ${d14}::timestamptz AT TIME ZONE 'UTC'), date_trunc('day', ${now}::timestamptz AT TIME ZONE 'UTC'), interval '1 day') AS day
        ),
        tx AS (
          SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
                 count(DISTINCT user_id)::int AS active,
                 coalesce(sum(-amount) FILTER (WHERE type IN ('bet', 'refund')), 0) AS wagered,
                 coalesce(sum(-amount) FILTER (WHERE type IN ${GAME}), 0) AS net
          FROM transactions WHERE created_at >= date_trunc('day', ${d14}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          GROUP BY 1
        ),
        su AS (
          SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, count(*)::int AS signups
          FROM users WHERE NOT is_anonymous AND created_at >= date_trunc('day', ${d14}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS day, coalesce(su.signups, 0) AS signups, coalesce(tx.active, 0) AS active,
               coalesce(tx.wagered, 0) AS wagered, coalesce(tx.net, 0) AS net
        FROM days LEFT JOIN tx ON tx.day = days.day LEFT JOIN su ON su.day = days.day
        ORDER BY days.day`),
      this.db.execute<{ game: string; rounds: number; players: number; wagered: string; paid: string; net: string }>(sql`
        SELECT game::text AS game,
               count(DISTINCT round_id) FILTER (WHERE type = 'bet')::int AS rounds,
               count(DISTINCT user_id)::int AS players,
               coalesce(sum(-amount) FILTER (WHERE type IN ('bet', 'refund')), 0) AS wagered,
               coalesce(sum(amount) FILTER (WHERE type = 'payout'), 0) AS paid,
               coalesce(sum(-amount), 0) AS net
        FROM transactions WHERE created_at >= ${d7} AND type IN ${GAME} AND game IS NOT NULL
        GROUP BY game ORDER BY 4 DESC`),
      this.db.execute<{ type: string; amount: string }>(sql`
        SELECT type::text AS type, sum(amount) AS amount FROM transactions
        WHERE created_at >= ${d7} AND type NOT IN ${GAME} AND type <> 'tip'
        GROUP BY type ORDER BY abs(sum(amount)) DESC`),
      this.db.execute<{ user_id: string; name: string; net: string }>(sql`
        SELECT t.user_id, u.name, sum(t.amount) AS net FROM transactions t JOIN users u ON u.id = t.user_id
        WHERE t.created_at >= ${d1} AND t.type IN ${GAME}
        GROUP BY t.user_id, u.name`),
      // Routine sign-ins are noise here; failed ones stay visible.
      this.db.select().from(adminAudit).where(sql`${adminAudit.action} <> 'login'`).orderBy(desc(adminAudit.createdAt)).limit(12),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(events)
        .where(and(sql`${events.status} IN ('scheduled', 'live')`, lt(events.startsAt, now), gt(events.endsAt, now))),
    ]);

    const t = day24.rows[0];
    const allNets = nets.rows.map((r) => ({ userId: r.user_id, name: r.name, net: Number(r.net) }));
    const data: AdminOverviewDTO = {
      generatedAt: now.toISOString(),
      totals: {
        players: stats.players,
        guests: stats.guests,
        active24h: t?.active ?? 0,
        signups24h: signups.rows[0]?.d1 ?? 0,
        signups7d: signups.rows[0]?.d7 ?? 0,
        chipsInPlay: stats.chipsInPlay,
        wagered24h: Number(t?.wagered ?? 0),
        houseNet24h: Number(t?.net ?? 0),
        rounds24h: t?.rounds ?? 0,
      },
      days: days.rows.map((r) => ({
        day: r.day,
        signups: r.signups,
        active: r.active,
        wagered: Number(r.wagered),
        houseNet: Number(r.net),
      })),
      games: games.rows.map((g) => ({
        game: g.game,
        rounds: g.rounds,
        players: g.players,
        wagered: Number(g.wagered),
        paidOut: Number(g.paid),
        houseNet: Number(g.net),
      })),
      flows: flows.rows.map((f) => ({ type: f.type as AdminOverviewDTO["flows"][number]["type"], amount: Number(f.amount) })),
      winners24h: allNets.filter((n) => n.net > 0).sort((a, b) => b.net - a.net).slice(0, 5),
      losers24h: allNets.filter((n) => n.net < 0).sort((a, b) => a.net - b.net).slice(0, 5),
      liveRooms: roomsList(liveRooms),
      liveEvents: liveEvents[0]?.n ?? 0,
      audit: auditRows.map((a) => ({
        id: a.id,
        action: a.action,
        targetUserId: a.targetUserId,
        detail: a.detail ?? null,
        at: a.createdAt.toISOString(),
      })),
    };
    this.overviewCache = { at: now.getTime(), data };
    return data;
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
      chatMutedAt: u.chatMutedAt?.toISOString() ?? null,
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

  async setChatMuted(userId: string, muted: boolean) {
    const [row] = await this.db
      .update(users)
      .set({ chatMutedAt: muted ? this.clock() : null })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!row) await this.user(userId);
  }

  async signOutEverywhere(userId: string): Promise<number> {
    await this.user(userId);
    const removed = await this.db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    return removed.length;
  }
}
