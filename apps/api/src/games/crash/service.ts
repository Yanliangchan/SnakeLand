import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  CRASH_LIMITS,
  CRASH_ROOM,
  crashMultiplierAt,
  crashPayout,
  type CrashBetPublicDTO,
  type CrashMyBetDTO,
  type CrashRoundDTO,
  type CrashStateDTO,
} from "@snakeland/shared";
import type { Db, DbOrTx, Tx } from "../../db/client";
import { crashBets, crashRounds, users } from "../../db/schema";
import type { Bus } from "../../realtime/bus";
import type { LiveBusMessage } from "../../realtime/messages";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";

export type CrashRoundRow = typeof crashRounds.$inferSelect;
export type CrashBetRow = typeof crashBets.$inferSelect;

/** Bets close slightly before takeoff, so a request in flight at the buzzer is rejected, not raced. */
export const CRASH_BET_GRACE_MS = 250;
const RECENT = 20;
const PUBLIC_BETS = 50;

export function crashRoundDTO(row: CrashRoundRow): CrashRoundDTO {
  const crashed = row.phase === "crashed";
  return {
    id: row.id,
    number: row.number,
    phase: row.phase,
    commit: row.serverSeedHash,
    opensAt: row.opensAt.toISOString(),
    startsAt: row.startsAt.toISOString(),
    // The crash point and its time stay secret until it happens.
    crashedAt: crashed ? (row.crashedAt?.toISOString() ?? null) : null,
    crashX100: crashed ? row.crashX100 : null,
    serverSeed: crashed ? row.serverSeed : null,
  };
}

export function myBetDTO(bet: CrashBetRow): CrashMyBetDTO {
  return {
    roundId: bet.roundId,
    amount: bet.amount,
    autoCashoutX100: bet.autoCashoutX100,
    cashoutX100: bet.cashoutX100,
    payout: bet.payout,
  };
}

export class CrashService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly bus: Bus,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async liveRound(q: DbOrTx = this.db) {
    const [row] = await q.select().from(crashRounds).where(ne(crashRounds.phase, "crashed"));
    return row ?? null;
  }

  async betsSummary(roundId: string, viewerId?: string) {
    const rows = await this.db
      .select({
        userId: crashBets.userId,
        name: users.name,
        amount: crashBets.amount,
        cashoutX100: crashBets.cashoutX100,
        payout: crashBets.payout,
      })
      .from(crashBets)
      .innerJoin(users, eq(users.id, crashBets.userId))
      .where(eq(crashBets.roundId, roundId))
      .orderBy(desc(crashBets.amount))
      .limit(PUBLIC_BETS);
    const [agg] = await this.db
      .select({ players: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${crashBets.amount}), 0)` })
      .from(crashBets)
      .where(eq(crashBets.roundId, roundId));
    const bets: CrashBetPublicDTO[] = rows.map((r) => ({
      name: r.name,
      amount: r.amount,
      cashoutX100: r.cashoutX100,
      payout: r.payout,
      ...(viewerId && r.userId === viewerId ? { isMe: true } : {}),
    }));
    return { bets, players: agg?.players ?? 0, totalStaked: Number(agg?.total ?? 0) };
  }

  /** The live round (or the last crash), recent crash points and who's in. */
  async state(viewerId?: string): Promise<CrashStateDTO> {
    const live = await this.liveRound();
    const crashed = await this.db
      .select()
      .from(crashRounds)
      .where(eq(crashRounds.phase, "crashed"))
      .orderBy(desc(crashRounds.number))
      .limit(RECENT);
    const current = live ?? crashed[0] ?? null;
    const summary = current ? await this.betsSummary(current.id, viewerId) : { bets: [], players: 0, totalStaked: 0 };
    return { round: current ? crashRoundDTO(current) : null, recent: crashed.map((r) => r.crashX100), ...summary };
  }

  async myBet(userId: string, roundId: string): Promise<CrashMyBetDTO | null> {
    const [bet] = await this.db
      .select()
      .from(crashBets)
      .where(and(eq(crashBets.roundId, roundId), eq(crashBets.userId, userId)));
    return bet ? myBetDTO(bet) : null;
  }

  async publishBets(roundId: string) {
    const summary = await this.betsSummary(roundId);
    await this.bus.publish({
      kind: "room",
      room: CRASH_ROOM,
      message: { type: "crash-bets", roundId, ...summary },
    } satisfies LiveBusMessage);
  }

  private async lockBettingRound(tx: DbOrTx, roundId: string) {
    // FOR SHARE: many players can bet at once, but takeoff/crash (UPDATEs) wait for them.
    const [round] = await tx.select().from(crashRounds).where(eq(crashRounds.id, roundId)).for("share");
    if (!round) throw new GameError(404, "ROUND_NOT_FOUND", "Round not found");
    if (round.phase !== "betting" || this.clock().getTime() >= round.startsAt.getTime() - CRASH_BET_GRACE_MS) {
      throw new GameError(409, "BETTING_CLOSED", "Bets are closed for this round");
    }
    return round;
  }

  async bet(userId: string, input: { roundId: string; amount: number; autoCashoutX100?: number | null }) {
    const { minBet, maxBet, minAutoX100, maxAutoX100 } = CRASH_LIMITS;
    if (!Number.isSafeInteger(input.amount) || input.amount < minBet || input.amount > maxBet) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${minBet}–${maxBet.toLocaleString()} chips`);
    }
    const auto = input.autoCashoutX100 ?? null;
    if (auto !== null && (!Number.isSafeInteger(auto) || auto < minAutoX100 || auto > maxAutoX100)) {
      throw new GameError(400, "INVALID_AUTO_CASHOUT", "Auto cash-out must be between 1.01× and 10,000×");
    }
    const result = await this.db.transaction(async (tx) => {
      const round = await this.lockBettingRound(tx, input.roundId);
      const [existing] = await tx
        .select({ id: crashBets.id })
        .from(crashBets)
        .where(and(eq(crashBets.roundId, round.id), eq(crashBets.userId, userId)));
      if (existing) throw new GameError(409, "ALREADY_BET", "You're already in this round");
      const debit = await this.wallet.apply(
        { userId, amount: -input.amount, type: "bet", game: "crash", roundId: round.id, meta: { auto } },
        tx,
      );
      const [bet] = await tx
        .insert(crashBets)
        .values({ roundId: round.id, userId, amount: input.amount, autoCashoutX100: auto })
        .returning();
      return { myBet: myBetDTO(bet!), balance: debit.balance };
    });
    await this.publishBets(input.roundId);
    return result;
  }

  /** Take a bet back before takeoff. */
  async cancel(userId: string, input: { roundId: string }) {
    const result = await this.db.transaction(async (tx) => {
      const round = await this.lockBettingRound(tx, input.roundId);
      const [removed] = await tx
        .delete(crashBets)
        .where(and(eq(crashBets.roundId, round.id), eq(crashBets.userId, userId)))
        .returning();
      if (!removed) throw new GameError(404, "NO_BET", "You have no bet in this round");
      const credit = await this.wallet.apply(
        { userId, amount: removed.amount, type: "refund", game: "crash", roundId: round.id, idempotencyKey: `${removed.id}:refund` },
        tx,
      );
      return { myBet: null, balance: credit.balance };
    });
    await this.publishBets(input.roundId);
    return result;
  }

  /** Cash out at the multiplier the server sees now. */
  async cashout(userId: string, input: { roundId: string }) {
    const result = await this.db.transaction(async (tx) => {
      const [round] = await tx.select().from(crashRounds).where(eq(crashRounds.id, input.roundId)).for("share");
      if (!round) throw new GameError(404, "ROUND_NOT_FOUND", "Round not found");
      const now = this.clock().getTime();
      if (round.phase === "crashed" || now >= round.crashesAt.getTime()) {
        throw new GameError(409, "CRASHED", "Too late, it crashed");
      }
      if (now < round.startsAt.getTime()) throw new GameError(409, "NOT_STARTED", "The round hasn't taken off yet");

      const [bet] = await tx
        .select()
        .from(crashBets)
        .where(and(eq(crashBets.roundId, round.id), eq(crashBets.userId, userId)))
        .for("update");
      if (!bet) throw new GameError(404, "NO_BET", "You have no bet in this round");
      if (bet.cashoutX100 !== null) throw new GameError(409, "ALREADY_CASHED_OUT", "Already cashed out");

      let x100 = crashMultiplierAt(now - round.startsAt.getTime());
      // If the dealer hasn't processed an auto cash-out yet, honour the auto target.
      if (bet.autoCashoutX100 !== null && x100 >= bet.autoCashoutX100) x100 = bet.autoCashoutX100;
      return this.settleCashout(tx, bet, x100);
    });
    await this.publishBets(input.roundId);
    return result;
  }

  /** Pay a bet out at `x100`. Only succeeds once per bet. */
  async settleCashout(tx: Tx, bet: CrashBetRow, x100: number) {
    const payout = crashPayout(bet.amount, x100);
    const [updated] = await tx
      .update(crashBets)
      .set({ cashoutX100: x100, payout })
      .where(and(eq(crashBets.id, bet.id), isNull(crashBets.cashoutX100)))
      .returning();
    if (!updated) throw new GameError(409, "ALREADY_CASHED_OUT", "Already cashed out");
    const credit = await this.wallet.apply(
      { userId: bet.userId, amount: payout, type: "payout", game: "crash", roundId: bet.roundId, idempotencyKey: `${bet.id}:payout`, meta: { x100 } },
      tx,
    );
    return { myBet: myBetDTO(updated), balance: credit.balance };
  }
}
