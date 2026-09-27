import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  ALL_TIME_PERKS,
  HALL_OF_FAME_SIZE,
  LAST_PLACE_TITLE,
  claimTerms,
  titleForWeeklyRank,
  weekKey,
  weekStart,
  type LeaderboardDTO,
  type LeaderboardKind,
  type PlayerTag,
  type ProfileDTO,
  type PublicProfileDTO,
} from "@snakeland/shared";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { WalletError } from "../wallet/errors";
import type { WalletService } from "../wallet/wallet-service";
import { walletStatsTable } from "./tables";

const BOARD_SIZE = 50;
const CACHE_MS = 30_000;

type Row = { userId: string; name: string; profit: number; joined: Date };

/** Tiny per-process TTL cache: leaderboards are read far more often than they change. */
class TtlCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private readonly ttlMs: number) {}
  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }
  clear() {
    this.entries.clear();
  }
}

/**
 * Leaderboards, titles, perks and profiles, all read from the running
 * counters on `wallets` (no scans of the ledger for rankings).
 */
export class ProgressService {
  private cache = new TtlCache<Row[]>(CACHE_MS);

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Drop cached boards (after an admin rename or suspension). */
  invalidate() {
    this.cache.clear();
  }

  private eligible() {
    return and(eq(users.isAnonymous, false), isNull(users.suspendedAt));
  }

  /** Profit expression for a board (weekly uses the current week only). */
  private profitColumn(kind: LeaderboardKind) {
    const w = walletStatsTable;
    return kind === "alltime"
      ? sql<number>`${w.lifetimeProfit}`
      : sql<number>`CASE WHEN ${w.weekKey} = ${weekKey(this.clock())} THEN ${w.weekProfit} ELSE 0 END`;
  }

  private async top(kind: LeaderboardKind, limit: number): Promise<Row[]> {
    const w = walletStatsTable;
    const profit = this.profitColumn(kind);
    const rows = await this.db
      .select({ userId: users.id, name: users.name, profit, joined: users.createdAt })
      .from(w)
      .innerJoin(users, eq(users.id, w.userId))
      .where(and(this.eligible(), gt(profit, 0), kind === "weekly" ? eq(w.weekKey, weekKey(this.clock())) : undefined))
      .orderBy(desc(profit), users.createdAt)
      .limit(limit);
    return rows.map((r) => ({ ...r, profit: Number(r.profit) }));
  }

  private board(kind: LeaderboardKind) {
    return this.cache.get(`${kind}:${weekKey(this.clock())}`, () => this.top(kind, BOARD_SIZE));
  }

  /** A player's rank on a board (ties broken by join date), or null if they don't place. */
  async rank(kind: LeaderboardKind, userId: string): Promise<{ rank: number | null; profit: number }> {
    const w = walletStatsTable;
    const profit = this.profitColumn(kind);
    const [me] = await this.db
      .select({ profit, joined: users.createdAt, isAnonymous: users.isAnonymous, suspendedAt: users.suspendedAt })
      .from(w)
      .innerJoin(users, eq(users.id, w.userId))
      .where(eq(w.userId, userId));
    if (!me) return { rank: null, profit: 0 };
    const mine = Number(me.profit);
    if (me.isAnonymous || me.suspendedAt || mine <= 0) return { rank: null, profit: mine };
    const [ahead] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(w)
      .innerJoin(users, eq(users.id, w.userId))
      .where(
        and(
          this.eligible(),
          kind === "weekly" ? eq(w.weekKey, weekKey(this.clock())) : undefined,
          or(gt(profit, mine), and(eq(profit, mine), lt(users.createdAt, me.joined))),
        ),
      );
    return { rank: (ahead?.n ?? 0) + 1, profit: mine };
  }

  /** The registered player with the biggest loss this week, if anyone is down. */
  private lastPlace() {
    return this.cache.get(`last:${weekKey(this.clock())}`, async () => {
      const w = walletStatsTable;
      const rows = await this.db
        .select({ userId: users.id, name: users.name, profit: w.weekProfit, joined: users.createdAt })
        .from(w)
        .innerJoin(users, eq(users.id, w.userId))
        .where(and(this.eligible(), eq(w.weekKey, weekKey(this.clock())), lt(w.weekProfit, 0)))
        .orderBy(asc(w.weekProfit), users.createdAt)
        .limit(1);
      return rows.map((r) => ({ ...r, profit: Number(r.profit) }));
    });
  }

  /**
   * Name decorations: a title from this week's board (top 3, plus "Safety
   * Stores" for last place) and a name colour from the all-time top 3.
   */
  async tags(players: Array<{ userId: string; name: string }>): Promise<Map<string, PlayerTag>> {
    const [allTime, weekly, last] = await Promise.all([this.board("alltime"), this.board("weekly"), this.lastPlace()]);
    const allTimeRank = new Map(allTime.map((r, i) => [r.userId, i + 1]));
    const weeklyRank = new Map(weekly.map((r, i) => [r.userId, i + 1]));
    const lastId = last[0]?.userId;
    return new Map(
      players.map((p) => {
        const rank = allTimeRank.get(p.userId) ?? null;
        return [
          p.userId,
          {
            name: p.name,
            title: p.userId === lastId ? LAST_PLACE_TITLE : titleForWeeklyRank(weeklyRank.get(p.userId) ?? null),
            nameColour: ALL_TIME_PERKS.find((k) => k.rank === rank)?.nameColour ?? null,
            hallOfFame: rank !== null && rank <= HALL_OF_FAME_SIZE,
          },
        ];
      }),
    );
  }

  async leaderboard(kind: LeaderboardKind, viewerId: string | null): Promise<LeaderboardDTO> {
    const rows = await this.board(kind);
    const last = kind === "weekly" ? (await this.lastPlace())[0] : undefined;
    const tags = await this.tags(last ? [...rows, last] : rows);
    const key = weekKey(this.clock());
    return {
      kind,
      weekStartsAt: kind === "weekly" ? weekStart(key).toISOString() : null,
      weekEndsAt: kind === "weekly" ? weekStart(key + 1).toISOString() : null,
      entries: rows.map((r, i) => ({
        ...tags.get(r.userId)!,
        userId: r.userId,
        rank: i + 1,
        profit: r.profit,
        isMe: r.userId === viewerId,
      })),
      lastPlace: last
        ? { ...tags.get(last.userId)!, userId: last.userId, profit: last.profit, isMe: last.userId === viewerId }
        : null,
      me: viewerId ? await this.rank(kind, viewerId) : null,
    };
  }

  /** What this player's next daily claim pays (perks apply to registered players only). */
  async claimTermsFor(userId: string, isGuest: boolean) {
    if (isGuest) return claimTerms(null);
    return claimTerms((await this.rank("alltime", userId)).rank);
  }

  async claimDaily(userId: string, isGuest: boolean) {
    const terms = await this.claimTermsFor(userId, isGuest);
    const result = await this.wallet.claimDaily(userId, terms);
    return { ...result, amount: terms.amount, reasons: terms.reasons };
  }

  async profile(userId: string): Promise<ProfileDTO> {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isAnonymous: users.isAnonymous,
        joined: users.createdAt,
        balance: walletStatsTable.balance,
        totalWagered: walletStatsTable.totalWagered,
        biggestWin: walletStatsTable.biggestWin,
        nextDailyClaimAt: walletStatsTable.nextDailyClaimAt,
      })
      .from(users)
      .leftJoin(walletStatsTable, eq(walletStatsTable.userId, users.id))
      .where(eq(users.id, userId));
    if (!row) throw new WalletError("WALLET_NOT_FOUND", "Player not found");
    if (row.balance === null) await this.wallet.getWallet(userId);

    const [weekly, allTime, tags, games] = await Promise.all([
      this.rank("weekly", userId),
      this.rank("alltime", userId),
      this.tags([{ userId, name: row.name }]),
      this.db.execute<{ game: string; rounds: number }>(sql`
        SELECT game::text AS game, count(DISTINCT round_id)::int AS rounds FROM transactions
        WHERE user_id = ${userId} AND type = 'bet' GROUP BY game ORDER BY rounds DESC`),
    ]);
    const gameRows = games.rows;
    const now = this.clock();
    const next = row.nextDailyClaimAt && row.nextDailyClaimAt > now ? row.nextDailyClaimAt.toISOString() : null;

    return {
      user: {
        ...tags.get(userId)!,
        id: row.id,
        email: row.isAnonymous ? null : row.email,
        isGuest: row.isAnonymous,
        joinedAt: row.joined.toISOString(),
      },
      balance: row.balance ?? (await this.wallet.getWallet(userId)).balance,
      stats: {
        weeklyProfit: weekly.profit,
        weeklyRank: weekly.rank,
        allTimeProfit: allTime.profit,
        allTimeRank: allTime.rank,
        totalWagered: row.totalWagered ?? 0,
        biggestWin: row.biggestWin ?? 0,
        roundsPlayed: gameRows.reduce((s, g) => s + Number(g.rounds), 0),
        favouriteGame: gameRows[0]?.game ?? null,
        gameBreakdown: gameRows.map((g) => ({ game: g.game, rounds: Number(g.rounds) })),
      },
      perks: {
        nextClaim: claimTerms(row.isAnonymous ? null : allTime.rank),
        nextDailyClaimAt: next,
      },
    };
  }

  /** A registered, active player's public card. Guests and suspended players are not visible. */
  async publicProfile(userId: string): Promise<PublicProfileDTO | null> {
    const [u] = await this.db
      .select({ ok: sql<boolean>`true` })
      .from(users)
      .where(and(eq(users.id, userId), this.eligible()));
    if (!u) return null;
    const p = await this.profile(userId);
    return {
      user: {
        id: p.user.id,
        name: p.user.name,
        title: p.user.title,
        nameColour: p.user.nameColour,
        hallOfFame: p.user.hallOfFame,
        joinedAt: p.user.joinedAt,
      },
      stats: p.stats,
    };
  }
}
