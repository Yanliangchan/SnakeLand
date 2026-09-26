import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  ROULETTE_TIMING,
  ROULETTE_WHEELS,
  hashServerSeed,
  rouletteResult,
  rouletteReturn,
  rouletteRoom,
  type RouletteSettlementDTO,
  type WheelId,
} from "@snakeland/shared";
import type { Db } from "../../db/client";
import { rouletteBets, rouletteRounds } from "../../db/schema";
import type { Bus } from "../../realtime/bus";
import { IdleLoop } from "../../realtime/idle-loop";
import type { Leadership } from "../../realtime/leader";
import type { LiveBusMessage } from "../../realtime/messages";
import type { Presence, RoomCounts } from "../../realtime/presence";
import type { WalletService } from "../../wallet/wallet-service";
import type { RoundRow, RouletteService } from "./service";

const TICK_MS = 200;
const PRESENCE_REFRESH_MS = 2_000;

/** Nothing to do for this wheel before `until` (ms), or until someone watches it (`idle`). */
type Wait = { until: number } | { idle: true };

/**
 * Drives every wheel through betting → spinning → result → next round.
 * State lives in Postgres, so if the leader dies another instance picks up
 * exactly where it stopped. To stay cheap, the dealer remembers each wheel's
 * next deadline and skips the database until it passes, and a wheel nobody
 * is watching finishes its current round and then sleeps until a viewer
 * shows up (the hub publishes a "wake" message on join). When every wheel is
 * asleep the loop itself stops: no timer, no Redis, no Postgres.
 */
export class RouletteDealer {
  private ticking = false;
  private wasLeader = false;
  private waits = new Map<WheelId, Wait>();
  private viewers: RoomCounts | null = null;
  private viewersAt = 0;
  private readonly unsubscribe: () => void;
  private readonly loop = new IdleLoop(TICK_MS, () => this.tick());
  /** Only a started dealer runs its own timer (tests drive tick() directly). */
  private started = false;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly roulette: RouletteService,
    private readonly bus: Bus,
    private readonly leadership: Leadership,
    private readonly presence: Presence,
    private readonly log: { error: (obj: unknown, msg?: string) => void } = console,
  ) {
    this.unsubscribe = bus.subscribe((m) => {
      const msg = m as LiveBusMessage;
      const wheel = msg.kind === "wake" ? ROULETTE_WHEELS.find((w) => rouletteRoom(w.id) === msg.room) : undefined;
      if (!wheel) return;
      this.waits.delete(wheel.id);
      this.viewersAt = 0;
      if (this.started) this.loop.wake();
    });
  }

  /** Runs until nothing is live, then sleeps until someone opens a wheel. */
  start() {
    this.started = true;
    this.loop.wake();
  }

  get awake() {
    return this.loop.awake;
  }

  async stop() {
    this.loop.stop();
    this.unsubscribe();
    await this.leadership.release();
  }

  private async viewerCounts(): Promise<RoomCounts> {
    if (!this.viewers || Date.now() - this.viewersAt >= PRESENCE_REFRESH_MS) {
      this.viewers = await this.presence.totals();
      this.viewersAt = Date.now();
    }
    return this.viewers;
  }

  /**
   * Advance every wheel whose deadline has passed. Safe to call concurrently
   * or from tests. Returns false once there is nothing left to do.
   */
  async tick(now = new Date()): Promise<boolean> {
    if (this.ticking) return true;
    this.ticking = true;
    try {
      const leader = await this.leadership.isLeader();
      // Another instance may have moved the wheels while we weren't leading.
      if (leader !== this.wasLeader) this.waits.clear();
      this.wasLeader = leader;
      const viewers = await this.viewerCounts();
      const watched = (id: WheelId) => (viewers[rouletteRoom(id)] ?? 0) > 0;
      const anyWatched = ROULETTE_WHEELS.some((w) => watched(w.id));
      // A follower stays awake only while someone watches, ready to take over.
      if (!leader) return anyWatched;
      for (const wheel of ROULETTE_WHEELS) {
        const wait = this.waits.get(wheel.id);
        if (wait && "until" in wait && now.getTime() < wait.until) continue;
        if (wait && "idle" in wait && !watched(wheel.id)) continue;
        this.waits.delete(wheel.id);
        try {
          await this.advance(wheel.id, wheel.offsetMs, now, watched(wheel.id));
        } catch (err) {
          this.log.error({ err, wheel: wheel.id }, "roulette tick failed");
        }
      }
      const allAsleep = ROULETTE_WHEELS.every((w) => {
        const wait = this.waits.get(w.id);
        return wait !== undefined && "idle" in wait;
      });
      return anyWatched || !allAsleep;
    } finally {
      this.ticking = false;
    }
  }

  private waitUntil(wheelId: WheelId, at: Date | null | undefined) {
    if (at) this.waits.set(wheelId, { until: at.getTime() });
  }

  private async advance(wheelId: WheelId, offsetMs: number, now: Date, watched: boolean) {
    const [live] = await this.db
      .select()
      .from(rouletteRounds)
      .where(and(eq(rouletteRounds.wheelId, wheelId), ne(rouletteRounds.phase, "settled")));

    if (live?.phase === "betting") {
      if (now >= live.closesAt) return this.close(live, now);
      return this.waitUntil(wheelId, live.closesAt);
    }
    if (live?.phase === "spinning") {
      if (live.spinEndsAt && now >= live.spinEndsAt) return this.settle(live, now);
      return this.waitUntil(wheelId, live.spinEndsAt);
    }

    const [last] = await this.db
      .select()
      .from(rouletteRounds)
      .where(eq(rouletteRounds.wheelId, wheelId))
      .orderBy(desc(rouletteRounds.number))
      .limit(1);
    if (last?.settledAt && now.getTime() < last.settledAt.getTime() + ROULETTE_TIMING.resultMs) {
      return this.waitUntil(wheelId, new Date(last.settledAt.getTime() + ROULETTE_TIMING.resultMs));
    }
    if (!watched) {
      this.waits.set(wheelId, { idle: true });
      return;
    }
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
    if (!row) return;
    this.waitUntil(wheelId, row.closesAt);
    await this.publishState(wheelId);
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
    if (!row) return;
    this.waitUntil(row.wheelId as WheelId, row.spinEndsAt);
    await this.publishState(round.wheelId as WheelId);
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
    this.waitUntil(round.wheelId as WheelId, new Date(now.getTime() + ROULETTE_TIMING.resultMs));

    await this.publishState(round.wheelId as WheelId);
    for (const s of settlements) {
      const balance = s.balance ?? (await this.wallet.getWallet(s.userId)).balance;
      const msg: LiveBusMessage = {
        kind: "user",
        userId: s.userId,
        message: { type: "settled", settlement: { ...s.settlement, balance } },
      };
      await this.bus.publish(msg);
    }
  }

  private async publishState(wheelId: WheelId) {
    const wheel = await this.roulette.wheelState(wheelId);
    const msg: LiveBusMessage = { kind: "room", room: rouletteRoom(wheelId), message: { type: "state", wheel } };
    await this.bus.publish(msg);
  }
}
