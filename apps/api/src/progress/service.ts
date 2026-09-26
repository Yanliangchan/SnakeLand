import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  HALL_OF_FAME_SIZE,
  STREAK_PERKS,
  claimTerms,
  titleForAllTimeRank,
  utcDay,
  weekKey,
  weekStart,
  type LeaderboardDTO,
  type LeaderboardKind,
  type PlayerTag,
  type ProfileDTO,
} from "@snakeland/shared";
import type { Db } from "../db/client";
import { maintenanceState, playerPerks, users } from "../db/schema";
import { WalletError } from "../wallet/errors";
import type { WalletService } from "../wallet/wallet-service";
import { walletStatsTable } from "./tables";

const BOARD_SIZE = 50;
const CACHE_MS = 30_000;
const SNAPSHOT_KEY = "top5_snapshot_day";

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

  private async streaks(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ userId: playerPerks.userId, streak: playerPerks.top5Streak })
      .from(playerPerks)
      .where(inArray(playerPerks.userId, userIds));
    return new Map(rows.map((r) => [r.userId, r.streak]));
  }

  /** Name decorations: all-time titles and Hall of Fame, plus the gold name from a 7-day top-5 streak. */
  async tags(players: Array<{ userId: string; name: string }>): Promise<Map<string, PlayerTag>> {
    const allTime = await this.board("alltime");
    const allTimeRank = new Map(allTime.map((r, i) => [r.userId, i + 1]));
    const streaks = await this.streaks(players.map((p) => p.userId));
    return new Map(
      players.map((p) => {
        const rank = allTimeRank.get(p.userId) ?? null;
        return [
          p.userId,
          {
            name: p.name,
            title: titleForAllTimeRank(rank),
            hallOfFame: rank !== null && rank <= HALL_OF_FAME_SIZE,
            goldName: (streaks.get(p.userId) ?? 0) >= STREAK_PERKS.goldName.days,
          },
        ];
      }),
    );
  }

  async leaderboard(kind: LeaderboardKind, viewerId: string | null): Promise<LeaderboardDTO> {
    const rows = await this.board(kind);
    const tags = await this.tags(rows);
    const key = weekKey(this.clock());
    return {
      kind,
      weekStartsAt: kind === "weekly" ? weekStart(key).toISOString() : null,
      weekEndsAt: kind === "weekly" ? weekStart(key + 1).toISOString() : null,
      entries: rows.map((r, i) => ({ ...tags.get(r.userId)!, rank: i + 1, profit: r.profit, isMe: r.userId === viewerId })),
      me: viewerId ? await this.rank(kind, viewerId) : null,
    };
  }

  private async streakOf(userId: string) {
    return (await this.streaks([userId])).get(userId) ?? 0;
  }

  /** What this player's next daily claim pays (perks apply to registered players only). */
  async claimTermsFor(userId: string, isGuest: boolean) {
    if (isGuest) return claimTerms(null, 0);
    const [streak, weekly] = await Promise.all([this.streakOf(userId), this.rank("weekly", userId)]);
    return claimTerms(weekly.rank, streak);
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

    const [weekly, allTime, streak, tags, games] = await Promise.all([
      this.rank("weekly", userId),
      this.rank("alltime", userId),
      this.streakOf(userId),
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
      },
      perks: {
        top5Streak: streak,
        nextClaim: claimTerms(row.isAnonymous ? null : weekly.rank, row.isAnonymous ? 0 : streak),
        nextDailyClaimAt: next,
      },
    };
  }

  /**
   * Once per UTC day: record who finished yesterday in the weekly top 5 and
   * extend (or reset) their streaks. Safe to call repeatedly and from several
   * instances; only the first call of the day does the work.
   */
  async snapshotTop5(now = this.clock()): Promise<boolean> {
    const today = utcDay(now);
    const yesterdayDate = new Date(now.getTime() - 86_400_000);
    const yesterday = utcDay(yesterdayDate);
    const dayBefore = utcDay(new Date(now.getTime() - 2 * 86_400_000));
    const wk = weekKey(new Date(`${yesterday}T12:00:00Z`));

    return this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(maintenanceState)
        .values({ key: SNAPSHOT_KEY, value: today })
        .onConflictDoUpdate({
          target: maintenanceState.key,
          set: { value: today },
          where: sql`${maintenanceState.value} <> ${today}`,
        })
        .returning();
      if (claimed.length === 0) return false; // already done today

      const w = walletStatsTable;
      // Yesterday's standings, even if a player has since rolled into a new week.
      const profit = sql<number>`CASE WHEN ${w.weekKey} = ${wk} THEN ${w.weekProfit} WHEN ${w.prevWeekKey} = ${wk} THEN ${w.prevWeekProfit} ELSE 0 END`;
      const top5 = await tx
        .select({ userId: users.id })
        .from(w)
        .innerJoin(users, eq(users.id, w.userId))
        .where(and(this.eligible(), gt(profit, 0)))
        .orderBy(desc(profit), users.createdAt)
        .limit(5);
      const ids = top5.map((t) => t.userId);

      for (const userId of ids) {
        await tx
          .insert(playerPerks)
          .values({ userId, top5Streak: 1, lastTop5Day: yesterday })
          .onConflictDoUpdate({
            target: playerPerks.userId,
            set: {
              top5Streak: sql`CASE WHEN ${playerPerks.lastTop5Day} = ${dayBefore} THEN ${playerPerks.top5Streak} + 1
                                   WHEN ${playerPerks.lastTop5Day} = ${yesterday} THEN ${playerPerks.top5Streak}
                                   ELSE 1 END`,
              lastTop5Day: yesterday,
            },
          });
      }
      // Anyone not in yesterday's top 5 loses their streak.
      await tx
        .update(playerPerks)
        .set({ top5Streak: 0 })
        .where(and(gt(playerPerks.top5Streak, 0), or(isNull(playerPerks.lastTop5Day), lt(playerPerks.lastTop5Day, yesterday))));
      this.cache.clear();
      return true;
    });
  }
}
