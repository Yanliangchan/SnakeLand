import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import {
  DAILY_CLAIM_AMOUNT,
  DAILY_COOLDOWN_HOURS,
  MAX_BALANCE,
  STARTING_BALANCE,
  isChipAmount,
  type Chips,
  type GameId,
  type TransactionDTO,
  type TransactionPageDTO,
  type TransactionType,
  type WalletDTO,
  weekKey,
} from "@snakeland/shared";

/** Ledger types that count as play (profit, wagered, biggest win). */
const PLAY_TYPES = new Set<TransactionType>(["bet", "payout", "refund"]);

export interface ClaimOptions {
  amount: number;
  cooldownHours: number;
  reasons?: string[];
}
import type { Db, DbOrTx, Tx } from "../db/client";
import { transactions, wallets } from "../db/schema";
import { WalletError } from "./errors";

export interface ApplyInput {
  userId: string;
  /** Signed chip delta: negative for bets, positive for payouts/claims. */
  amount: Chips;
  type: TransactionType;
  game?: GameId;
  tableId?: string;
  roundId?: string;
  /** Replaying the same key returns the original result instead of applying twice. */
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
}

export interface ApplyResult {
  transaction: TransactionDTO;
  balance: Chips;
  /** False when the idempotency key matched an earlier transaction. */
  applied: boolean;
}

type TransactionRow = typeof transactions.$inferSelect;
type WalletRow = typeof wallets.$inferSelect;

function toDTO(row: TransactionRow): TransactionDTO {
  return {
    id: row.id,
    game: row.game,
    tableId: row.tableId,
    roundId: row.roundId,
    amount: row.amount,
    type: row.type,
    balanceAfter: row.balanceAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

function nextClaimAt(wallet: Pick<WalletRow, "nextDailyClaimAt">, now: Date): Date | null {
  return wallet.nextDailyClaimAt && wallet.nextDailyClaimAt > now ? wallet.nextDailyClaimAt : null;
}

/**
 * The single owner of balance mutations. Every change:
 *   1. runs inside a DB transaction,
 *   2. takes a row lock on the user's wallet (SELECT ... FOR UPDATE), which
 *      serialises concurrent requests for the same user,
 *   3. writes exactly one ledger row carrying balance_after.
 *
 * Games must call `apply` (optionally passing their own transaction so round
 * state and money commit together) and never read/write `wallets` themselves.
 */
export class WalletService {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Run `fn` in the caller's transaction if given, otherwise in a new one. */
  private inTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * Create the wallet (with the starting grant) if it does not exist yet.
   * Safe under concurrency: only the request that wins the insert records the bonus.
   */
  private async ensure(tx: DbOrTx, userId: string): Promise<void> {
    const inserted = await tx
      .insert(wallets)
      .values({ userId, balance: STARTING_BALANCE })
      .onConflictDoNothing({ target: wallets.userId })
      .returning({ userId: wallets.userId });
    if (inserted.length > 0) {
      await tx.insert(transactions).values({
        userId,
        amount: STARTING_BALANCE,
        type: "signup_bonus",
        balanceAfter: STARTING_BALANCE,
      });
    }
  }

  private async lock(tx: Tx, userId: string): Promise<WalletRow> {
    await this.ensure(tx, userId);
    const [row] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for("update");
    if (!row) throw new WalletError("WALLET_NOT_FOUND", "Wallet not found");
    return row;
  }

  async getWallet(userId: string): Promise<WalletDTO> {
    await this.ensure(this.db, userId);
    const [row] = await this.db.select().from(wallets).where(eq(wallets.userId, userId));
    if (!row) throw new WalletError("WALLET_NOT_FOUND", "Wallet not found");
    return {
      balance: row.balance,
      nextDailyClaimAt: nextClaimAt(row, this.clock())?.toISOString() ?? null,
    };
  }

  async apply(input: ApplyInput, tx?: Tx): Promise<ApplyResult> {
    if (!isChipAmount(input.amount) || input.amount === 0) {
      throw new WalletError("INVALID_AMOUNT", "Amount must be a non-zero whole number of chips");
    }
    return this.inTx(tx, async (t) => {
      const wallet = await this.lock(t, input.userId);

      if (input.idempotencyKey) {
        const [existing] = await t
          .select()
          .from(transactions)
          .where(
            and(eq(transactions.userId, input.userId), eq(transactions.idempotencyKey, input.idempotencyKey)),
          );
        if (existing) return { transaction: toDTO(existing), balance: wallet.balance, applied: false };
      }

      const balanceAfter = wallet.balance + input.amount;
      if (balanceAfter < 0) {
        throw new WalletError("INSUFFICIENT_FUNDS", "Not enough chips", { balance: wallet.balance });
      }
      if (balanceAfter > MAX_BALANCE) {
        throw new WalletError("BALANCE_LIMIT", "Balance limit reached");
      }

      await t
        .update(wallets)
        .set({ balance: balanceAfter, ...this.counterUpdates(wallet, input.type, input.amount) })
        .where(eq(wallets.userId, input.userId));
      const [row] = await t
        .insert(transactions)
        .values({
          userId: input.userId,
          amount: input.amount,
          type: input.type,
          game: input.game ?? null,
          tableId: input.tableId ?? null,
          roundId: input.roundId ?? null,
          balanceAfter,
          idempotencyKey: input.idempotencyKey ?? null,
          meta: input.meta ?? null,
        })
        .returning();
      return { transaction: toDTO(row!), balance: balanceAfter, applied: true };
    });
  }

  /** Keep the leaderboard counters in step with every play transaction. */
  private counterUpdates(wallet: WalletRow, type: TransactionType, amount: number) {
    if (!PLAY_TYPES.has(type)) return {};
    const key = weekKey(this.clock());
    const sameWeek = wallet.weekKey === key;
    return {
      lifetimeProfit: wallet.lifetimeProfit + amount,
      // A new week rolls the old figure into prev_* (the daily snapshot may still need it).
      weekKey: key,
      weekProfit: (sameWeek ? wallet.weekProfit : 0) + amount,
      ...(sameWeek ? {} : { prevWeekKey: wallet.weekKey, prevWeekProfit: wallet.weekProfit }),
      totalWagered: wallet.totalWagered + (type === "bet" ? -amount : 0),
      biggestWin: type === "payout" ? Math.max(wallet.biggestWin, amount) : wallet.biggestWin,
    };
  }

  /**
   * Daily free chips. `options` carries perk-adjusted terms (amount and
   * cooldown); without it the standard claim applies.
   */
  async claimDaily(userId: string, options?: ClaimOptions): Promise<ApplyResult & { nextDailyClaimAt: string }> {
    const amount = options?.amount ?? DAILY_CLAIM_AMOUNT;
    const cooldownMs = (options?.cooldownHours ?? DAILY_COOLDOWN_HOURS) * 3_600_000;
    return this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, userId);
      const now = this.clock();
      const blockedUntil = nextClaimAt(wallet, now);
      if (blockedUntil) {
        throw new WalletError("DAILY_CLAIM_NOT_READY", "Daily chips already claimed", {
          nextDailyClaimAt: blockedUntil.toISOString(),
        });
      }
      const next = new Date(now.getTime() + cooldownMs);
      await tx.update(wallets).set({ lastDailyClaimAt: now, nextDailyClaimAt: next }).where(eq(wallets.userId, userId));
      const result = await this.apply(
        { userId, amount, type: "daily_claim", meta: options?.reasons?.length ? { perks: options.reasons } : undefined },
        tx,
      );
      return { ...result, nextDailyClaimAt: next.toISOString() };
    });
  }

  /**
   * Admin balance change: `adjust` adds a signed delta, `set` moves the balance
   * to an exact figure. Either way it is one admin_adjust ledger row, so the
   * ledger still sums to the balance. Admin credits don't count as profit.
   */
  async adminAdjust(
    userId: string,
    input: { mode: "adjust" | "set"; amount: number },
    meta: Record<string, unknown>,
  ): Promise<ApplyResult> {
    return this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, userId);
      const delta = input.mode === "set" ? input.amount - wallet.balance : input.amount;
      if (delta === 0) {
        throw new WalletError("INVALID_AMOUNT", "That wouldn't change the balance");
      }
      return this.apply({ userId, amount: delta, type: "admin_adjust", meta }, tx);
    });
  }

  /** Let the player claim their daily chips again right away. */
  async resetDailyClaim(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      await tx.update(wallets).set({ nextDailyClaimAt: null }).where(eq(wallets.userId, userId));
    });
  }

  /**
   * Carry a guest's wallet over to a freshly registered account.
   *
   * Only applies when the target account has no wallet yet (i.e. it was just
   * created). Signing a guest into an *existing* account leaves both wallets
   * untouched, otherwise repeated guest sessions could be farmed for chips.
   * The move is recorded as a pair of guest_merge rows so the ledger stays
   * append-only and each user's rows still sum to their balance.
   */
  async mergeGuestWallet(guestUserId: string, newUserId: string): Promise<{ merged: boolean }> {
    if (guestUserId === newUserId) return { merged: false };
    return this.db.transaction(async (tx) => {
      const [target] = await tx.select().from(wallets).where(eq(wallets.userId, newUserId)).for("update");
      if (target) return { merged: false };

      const [guest] = await tx.select().from(wallets).where(eq(wallets.userId, guestUserId)).for("update");
      if (!guest) return { merged: false };

      const amount = guest.balance;
      await tx.insert(wallets).values({
        userId: newUserId,
        balance: amount,
        // Carry the cooldown so a guest can't claim, register, and claim again.
        lastDailyClaimAt: guest.lastDailyClaimAt,
        nextDailyClaimAt: guest.nextDailyClaimAt,
        // Their play history counts towards the new account.
        lifetimeProfit: guest.lifetimeProfit,
        weekKey: guest.weekKey,
        weekProfit: guest.weekProfit,
        prevWeekKey: guest.prevWeekKey,
        prevWeekProfit: guest.prevWeekProfit,
        totalWagered: guest.totalWagered,
        biggestWin: guest.biggestWin,
      });
      await tx.update(wallets).set({ balance: 0 }).where(eq(wallets.userId, guestUserId));

      if (amount > 0) {
        const meta = { from: guestUserId, to: newUserId };
        await tx.insert(transactions).values([
          { userId: guestUserId, amount: -amount, type: "guest_merge", balanceAfter: 0, meta },
          { userId: newUserId, amount, type: "guest_merge", balanceAfter: amount, meta },
        ]);
      }
      return { merged: true };
    });
  }

  async listTransactions(userId: string, opts: { cursor?: string; limit: number }): Promise<TransactionPageDTO> {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !cursor) throw new WalletError("INVALID_CURSOR", "Invalid cursor");
    await this.ensure(this.db, userId);

    const rows = await this.db
      .select()
      .from(transactions)
      .where(
        cursor
          ? and(
              eq(transactions.userId, userId),
              or(
                lt(transactions.createdAt, cursor.createdAt),
                and(eq(transactions.createdAt, cursor.createdAt), lt(transactions.id, cursor.id)),
              ),
            )
          : eq(transactions.userId, userId),
      )
      .orderBy(desc(transactions.createdAt), desc(transactions.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toDTO),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /** Ledger invariant check, used by tests and ops tooling. */
  async ledgerSum(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(eq(transactions.userId, userId));
    return Number(row?.total ?? 0);
  }
}

function encodeCursor(row: Pick<TransactionRow, "createdAt" | "id">): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [iso, id] = parsed as [unknown, unknown];
    if (typeof iso !== "string" || typeof id !== "string" || !UUID.test(id)) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
