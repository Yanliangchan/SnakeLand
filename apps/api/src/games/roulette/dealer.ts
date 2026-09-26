import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  ROULETTE_TIMING,
  ROULETTE_WHEELS,
  hashServerSeed,
  rouletteResult,
  rouletteReturn,
  type RouletteSettlementDTO,
  type WheelId,
} from "@snakeland/shared";
import type { Db } from "../../db/client";
import { rouletteBets, rouletteRounds } from "../../db/schema";
import type { Bus } from "../../realtime/bus";
import type { Leadership } from "../../realtime/leader";
import type { WalletService } from "../../wallet/wallet-service";
import type { RoundRow, RouletteBusMessage, RouletteService } from "./service";

const TICK_MS = 200;

/**
 * Drives every wheel through betting → spinning → result → next round.
 * Each tick reads the wheel's live round from Postgres and advances it if a
 * deadline has passed, so the loop holds no state of its own: if the leader
 * dies, another instance picks up exactly where it stopped.
 */
export class RouletteDealer {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly roulette: RouletteService,
    private readonly bus: Bus,
    private readonly leadership: Leadership,
    private readonly log: { error: (obj: unknown, msg?: string) => void } = console,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.leadership.release();
  }

  /** Advance every wheel whose deadline has passed. Safe to call concurrently or from tests. */
  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!(await this.leadership.isLeader())) return;
      for (const wheel of ROULETTE_WHEELS) {
        try {
          await this.advance(wheel.id, wheel.offsetMs, now);
        } catch (err) {
          this.log.error({ err, wheel: wheel.id }, "roulette tick failed");
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async advance(wheelId: WheelId, offsetMs: number, now: Date) {
    const [live] = await this.db
      .select()
      .from(rouletteRounds)
      .where(and(eq(rouletteRounds.wheelId, wheelId), ne(rouletteRounds.phase, "settled")));

    if (live?.phase === "betting" && now >= live.closesAt) return this.close(live, now);
    if (live?.phase === "spinning" && live.spinEndsAt && now >= live.spinEndsAt) return this.settle(live, now);
    if (live) return;

    const [last] = await this.db
      .select()
      .from(rouletteRounds)
      .where(eq(rouletteRounds.wheelId, wheelId))
      .orderBy(desc(rouletteRounds.number))
      .limit(1);
    if (last?.settledAt && now.getTime() < last.settledAt.getTime() + ROULETTE_TIMING.resultMs) return;
    // The very first round of each wheel is offset so the wheels run staggered.
    return this.open(wheelId, (last?.number ?? 0) + 1, now, last ? 0 : offsetMs);
  }

  private async open(wheelId: WheelId, number: number, now: Date, extraMs: number) {
    const serverSeed = randomBytes(32).toString("hex");
    const [row] = await this.db
      .insert(rouletteRounds)
      .values({
        id: randomUUID(),
        wheelId,
        number,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed),
        opensAt: now,
        closesAt: new Date(now.getTime() + ROULETTE_TIMING.bettingMs + extraMs),
      })
      // The partial unique index makes a duplicate open (two leaders for a moment) a no-op.
      .onConflictDoNothing()
      .returning();
    if (row) await this.publishState(wheelId);
  }

  private async close(round: RoundRow, now: Date) {
    // Waits for in-flight bet transactions (they hold FOR SHARE on this row).
    const [row] = await this.db
      .update(rouletteRounds)
      .set({
        phase: "spinning",
        result: rouletteResult(round.serverSeed, round.id),
        spinEndsAt: new Date(now.getTime() + ROULETTE_TIMING.spinMs),
      })
      .where(and(eq(rouletteRounds.id, round.id), eq(rouletteRounds.phase, "betting")))
      .returning();
    if (row) await this.publishState(round.wheelId as WheelId);
  }

  private async settle(round: RoundRow, now: Date) {
    const settlements = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(rouletteRounds)
        .where(and(eq(rouletteRounds.id, round.id), eq(rouletteRounds.phase, "spinning")))
        .for("update");
      if (!locked || locked.result === null) return null;
      const result = locked.result;

      const bets = await this.roulette.betsFor(tx, [locked.id]);
      const perUser = new Map<string, { staked: number; payout: number; tableId: string; winning: string[] }>();
      for (const bet of bets) {
        const payout = rouletteReturn(bet.betId, bet.amount, result);
        await tx.update(rouletteBets).set({ payout }).where(eq(rouletteBets.id, bet.id));
        const u = perUser.get(bet.userId) ?? { staked: 0, payout: 0, tableId: bet.tableId, winning: [] };
        u.staked += bet.amount;
        u.payout += payout;
        if (payout > 0 && !u.winning.includes(bet.betId)) u.winning.push(bet.betId);
        perUser.set(bet.userId, u);
      }

      const out: Array<{ userId: string; settlement: Omit<RouletteSettlementDTO, "balance">; balance: number | null }> = [];
      for (const [userId, u] of perUser) {
        let balance: number | null = null;
        if (u.payout > 0) {
          const credit = await this.wallet.apply(
            {
              userId,
              amount: u.payout,
              type: "payout",
              game: "roulette",
              tableId: u.tableId,
              roundId: locked.id,
              idempotencyKey: `${locked.id}:payout`,
            },
            tx,
          );
          balance = credit.balance;
        }
        out.push({
          userId,
          balance,
          settlement: {
            wheelId: locked.wheelId as WheelId,
            roundId: locked.id,
            result,
            staked: u.staked,
            payout: u.payout,
            winningBets: u.winning,
          },
        });
      }

      await tx
        .update(rouletteRounds)
        .set({ phase: "settled", settledAt: now })
        .where(eq(rouletteRounds.id, locked.id));
      return out;
    });
    if (!settlements) return;

    await this.publishState(round.wheelId as WheelId);
    for (const s of settlements) {
      const balance = s.balance ?? (await this.wallet.getWallet(s.userId)).balance;
      const msg: RouletteBusMessage = {
        kind: "user",
        userId: s.userId,
        message: { type: "settled", settlement: { ...s.settlement, balance } },
      };
      await this.bus.publish(msg);
    }
  }

  private async publishState(wheelId: WheelId) {
    const wheel = await this.roulette.wheelState(wheelId);
    const msg: RouletteBusMessage = { kind: "wheel", wheelId, message: { type: "state", wheel } };
    await this.bus.publish(msg);
  }
}
