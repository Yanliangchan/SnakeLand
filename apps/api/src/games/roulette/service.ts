import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  ROULETTE_BETS,
  ROULETTE_LIMITS,
  isWheelId,
  type RouletteMyBetsDTO,
  type RouletteRoundDTO,
  type RouletteWheelDTO,
  type WheelId,
} from "@snakeland/shared";
import type { Db, DbOrTx } from "../../db/client";
import { rouletteBets, rouletteRounds } from "../../db/schema";
import type { Bus } from "../../realtime/bus";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";

export type RoundRow = typeof rouletteRounds.$inferSelect;

/** Bets close slightly before the published time, so a request in flight at the buzzer is rejected, not raced. */
export const CLOSE_GRACE_MS = 250;
const RECENT = 12;

export function roundDTO(row: RoundRow): RouletteRoundDTO {
  const settled = row.phase === "settled";
  return {
    id: row.id,
    number: row.number,
    phase: settled ? "result" : (row.phase as "betting" | "spinning"),
    commit: row.serverSeedHash,
    opensAt: row.opensAt.toISOString(),
    closesAt: row.closesAt.toISOString(),
    spinEndsAt: row.spinEndsAt?.toISOString() ?? null,
    result: row.phase === "betting" ? null : row.result,
    serverSeed: settled ? row.serverSeed : null,
  };
}

/** Messages carried on the bus; the socket hub routes them. */
export type RouletteBusMessage =
  | { kind: "wheel"; wheelId: WheelId; message: unknown }
  | { kind: "user"; userId: string; message: unknown };

export class RouletteService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly bus: Bus,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async activity(q: DbOrTx, roundId: string) {
    const [row] = await q
      .select({
        players: sql<number>`count(distinct ${rouletteBets.userId})::int`,
        total: sql<string>`coalesce(sum(${rouletteBets.amount}), 0)`,
      })
      .from(rouletteBets)
      .where(eq(rouletteBets.roundId, roundId));
    return { players: row?.players ?? 0, totalStaked: Number(row?.total ?? 0) };
  }

  /** Current round (live, or the latest result) plus recent numbers for one wheel. */
  async wheelState(wheelId: WheelId): Promise<RouletteWheelDTO> {
    const [live] = await this.db
      .select()
      .from(rouletteRounds)
      .where(and(eq(rouletteRounds.wheelId, wheelId), ne(rouletteRounds.phase, "settled")));
    const settled = await this.db
      .select()
      .from(rouletteRounds)
      .where(and(eq(rouletteRounds.wheelId, wheelId), eq(rouletteRounds.phase, "settled")))
      .orderBy(desc(rouletteRounds.number))
      .limit(RECENT);
    const current = live ?? settled[0] ?? null;
    const act = current ? await this.activity(this.db, current.id) : { players: 0, totalStaked: 0 };
    return {
      wheelId,
      round: current ? roundDTO(current) : null,
      recent: settled.map((r) => r.result!).filter((n) => n !== null),
      ...act,
    };
  }

  async myBets(userId: string, roundId: string, q: DbOrTx = this.db): Promise<RouletteMyBetsDTO> {
    const rows = await q
      .select({ betId: rouletteBets.betId, amount: sql<string>`sum(${rouletteBets.amount})` })
      .from(rouletteBets)
      .where(and(eq(rouletteBets.roundId, roundId), eq(rouletteBets.userId, userId)))
      .groupBy(rouletteBets.betId);
    const bets = rows.map((r) => ({ betId: r.betId, amount: Number(r.amount) }));
    return { roundId, bets, total: bets.reduce((s, b) => s + b.amount, 0) };
  }

  async place(
    userId: string,
    input: { wheelId: string; roundId: string; tableId: string; bets: Array<{ betId: string; amount: number }> },
  ): Promise<{ myBets: RouletteMyBetsDTO; balance: number }> {
    if (!isWheelId(input.wheelId)) throw new GameError(400, "INVALID_WHEEL", "Unknown wheel");
    if (input.bets.length === 0) throw new GameError(400, "NO_BETS", "Place a bet first");
    let total = 0;
    for (const b of input.bets) {
      if (!ROULETTE_BETS.has(b.betId)) throw new GameError(400, "INVALID_BET", "That isn't a bet on this table");
      if (!Number.isSafeInteger(b.amount) || b.amount < ROULETTE_LIMITS.minBet) {
        throw new GameError(400, "BET_OUT_OF_RANGE", `Each bet must be at least ${ROULETTE_LIMITS.minBet}`);
      }
      total += b.amount;
    }

    const result = await this.db.transaction(async (tx) => {
      // FOR SHARE: many players can bet at once, but closing the round (an UPDATE) waits for them.
      const [round] = await tx
        .select()
        .from(rouletteRounds)
        .where(and(eq(rouletteRounds.id, input.roundId), eq(rouletteRounds.wheelId, input.wheelId)))
        .for("share");
      if (!round) throw new GameError(404, "ROUND_NOT_FOUND", "Round not found");
      if (round.phase !== "betting" || this.clock().getTime() >= round.closesAt.getTime() - CLOSE_GRACE_MS) {
        throw new GameError(409, "BETTING_CLOSED", "Bets are closed for this spin");
      }

      const debit = await this.wallet.apply(
        {
          userId,
          amount: -total,
          type: "bet",
          game: "roulette",
          tableId: input.tableId,
          roundId: round.id,
          meta: { bets: input.bets },
        },
        tx,
      );
      // The wallet row lock serialises this user's requests, so this sum is race-free.
      await tx.insert(rouletteBets).values(
        input.bets.map((b) => ({ roundId: round.id, userId, betId: b.betId, amount: b.amount, tableId: input.tableId })),
      );
      const mine = await this.myBets(userId, round.id, tx);
      if (mine.total > ROULETTE_LIMITS.maxRoundTotal) {
        throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are capped at ${ROULETTE_LIMITS.maxRoundTotal.toLocaleString()} per spin`);
      }
      return { myBets: mine, balance: debit.balance };
    });

    await this.publishActivity(input.wheelId, input.roundId);
    return result;
  }

  async clear(userId: string, input: { wheelId: string; roundId: string }) {
    if (!isWheelId(input.wheelId)) throw new GameError(400, "INVALID_WHEEL", "Unknown wheel");
    const result = await this.db.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(rouletteRounds)
        .where(and(eq(rouletteRounds.id, input.roundId), eq(rouletteRounds.wheelId, input.wheelId)))
        .for("share");
      if (!round) throw new GameError(404, "ROUND_NOT_FOUND", "Round not found");
      if (round.phase !== "betting" || this.clock().getTime() >= round.closesAt.getTime() - CLOSE_GRACE_MS) {
        throw new GameError(409, "BETTING_CLOSED", "Bets are closed for this spin");
      }
      const removed = await tx
        .delete(rouletteBets)
        .where(and(eq(rouletteBets.roundId, round.id), eq(rouletteBets.userId, userId)))
        .returning({ amount: rouletteBets.amount, tableId: rouletteBets.tableId });
      const refund = removed.reduce((s, r) => s + r.amount, 0);
      let balance = (await this.wallet.getWallet(userId)).balance;
      if (refund > 0) {
        const credit = await this.wallet.apply(
          {
            userId,
            amount: refund,
            type: "refund",
            game: "roulette",
            tableId: removed[0]!.tableId,
            roundId: round.id,
          },
          tx,
        );
        balance = credit.balance;
      }
      return { myBets: { roundId: round.id, bets: [], total: 0 }, balance };
    });
    await this.publishActivity(input.wheelId, input.roundId);
    return result;
  }

  private async publishActivity(wheelId: WheelId, roundId: string) {
    const act = await this.activity(this.db, roundId);
    const msg: RouletteBusMessage = {
      kind: "wheel",
      wheelId,
      message: { type: "activity", wheelId, roundId, ...act },
    };
    await this.bus.publish(msg);
  }

  /** Bets for a set of rounds, used by the dealer at settlement. */
  async betsFor(q: DbOrTx, roundIds: string[]) {
    if (roundIds.length === 0) return [];
    return q.select().from(rouletteBets).where(inArray(rouletteBets.roundId, roundIds));
  }
}
