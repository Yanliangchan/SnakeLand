import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  CRASH_ROOM,
  CRASH_TIMING,
  crashPointX100,
  crashTimeFor,
  hashServerSeed,
  type CrashSettlementDTO,
} from "@snakeland/shared";
import type { Db } from "../../db/client";
import { crashBets, crashRounds } from "../../db/schema";
import type { Bus } from "../../realtime/bus";
import { IdleLoop } from "../../realtime/idle-loop";
import type { Leadership } from "../../realtime/leader";
import type { LiveBusMessage } from "../../realtime/messages";
import type { Presence } from "../../realtime/presence";
import type { WalletService } from "../../wallet/wallet-service";
import type { CrashBetRow, CrashRoundRow, CrashService } from "./service";

const TICK_MS = 100;
const PRESENCE_REFRESH_MS = 2_000;

type Auto = { bet: CrashBetRow; at: number };

/**
 * Drives the shared Crash round: betting → running → crashed → next round.
 * State lives in Postgres; the dealer only caches the next deadline and the
 * auto cash-outs of the running round. A new round only opens while someone
 * is in the Crash room; otherwise the loop finishes the round and sleeps.
 */
export class CrashDealer {
  private ticking = false;
  private wasLeader = false;
  private until = 0;
  private idle = false;
  private autos: { roundId: string; queue: Auto[] } | null = null;
  private viewers = 0;
  private viewersAt = 0;
  private readonly unsubscribe: () => void;
  private readonly loop = new IdleLoop(TICK_MS, () => this.tick());
  /** Only a started dealer runs its own timer (tests drive tick() directly). */
  private started = false;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly crash: CrashService,
    private readonly bus: Bus,
    private readonly leadership: Leadership,
    private readonly presence: Presence,
    private readonly log: { error: (obj: unknown, msg?: string) => void } = console,
  ) {
    this.unsubscribe = bus.subscribe((m) => {
      const msg = m as LiveBusMessage;
      if (msg.kind !== "wake" || msg.room !== CRASH_ROOM) return;
      this.idle = false;
      this.until = 0;
      this.viewersAt = 0;
      if (this.started) this.loop.wake();
    });
  }

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

  private async watched() {
    if (Date.now() - this.viewersAt >= PRESENCE_REFRESH_MS) {
      this.viewers = (await this.presence.totals())[CRASH_ROOM] ?? 0;
      this.viewersAt = Date.now();
    }
    return this.viewers > 0;
  }

  /** Advance the round if a deadline passed. Returns false once there is nothing to do. */
  async tick(now = new Date()): Promise<boolean> {
    if (this.ticking) return true;
    this.ticking = true;
    try {
      const leader = await this.leadership.isLeader();
      if (leader !== this.wasLeader) {
        this.until = 0;
        this.autos = null;
      }
      this.wasLeader = leader;
      const watched = await this.watched();
      if (!leader) return watched;
      if (this.idle && !watched) return false;
      if (now.getTime() >= this.until) {
        this.idle = false;
        try {
          await this.advance(now, watched);
        } catch (err) {
          this.log.error({ err }, "crash tick failed");
          this.until = now.getTime() + 1_000;
        }
      }
      return watched || !this.idle;
    } finally {
      this.ticking = false;
    }
  }

  private async advance(now: Date, watched: boolean) {
    const live = await this.crash.liveRound();
    const t = now.getTime();

    if (live?.phase === "betting") {
      if (t < live.startsAt.getTime()) {
        this.until = live.startsAt.getTime();
        return;
      }
      await this.takeoff(live);
      return;
    }

    if (live?.phase === "running") {
      if (t >= live.crashesAt.getTime()) return this.crashRound(live, now);
      await this.payDueAutos(live, t);
      const nextAuto = this.autos?.queue[0]?.at ?? Infinity;
      this.until = Math.min(nextAuto, live.crashesAt.getTime());
      return;
    }

    const [last] = await this.db.select().from(crashRounds).orderBy(desc(crashRounds.number)).limit(1);
    const reopenAt = last?.crashedAt ? last.crashedAt.getTime() + CRASH_TIMING.crashedMs : 0;
    if (t < reopenAt) {
      this.until = reopenAt;
      return;
    }
    if (!watched) {
      this.idle = true;
      return;
    }
    await this.open((last?.number ?? 0) + 1, now);
  }

  private async open(number: number, now: Date) {
    const id = randomUUID();
    const serverSeed = randomBytes(32).toString("hex");
    const crashX100 = crashPointX100(serverSeed, id);
    const startsAt = new Date(now.getTime() + CRASH_TIMING.bettingMs);
    const [row] = await this.db
      .insert(crashRounds)
      .values({
        id,
        number,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed),
        crashX100,
        opensAt: now,
        startsAt,
        crashesAt: new Date(startsAt.getTime() + crashTimeFor(crashX100)),
      })
      // The partial unique index makes a duplicate open (two leaders for a moment) a no-op.
      .onConflictDoNothing()
      .returning();
    if (!row) return;
    this.until = row.startsAt.getTime();
    await this.publishState();
  }

  private async takeoff(round: CrashRoundRow) {
    // Waits for in-flight bets (they hold FOR SHARE on the round).
    const [row] = await this.db
      .update(crashRounds)
      .set({ phase: "running" })
      .where(and(eq(crashRounds.id, round.id), eq(crashRounds.phase, "betting")))
      .returning();
    if (!row) return;
    await this.loadAutos(row);
    this.until = Math.min(this.autos?.queue[0]?.at ?? Infinity, row.crashesAt.getTime());
    await this.publishState();
  }

  /** Auto cash-outs that will trigger this round, in time order. */
  private async loadAutos(round: CrashRoundRow) {
    const bets = await this.db
      .select()
      .from(crashBets)
      .where(and(eq(crashBets.roundId, round.id), isNotNull(crashBets.autoCashoutX100), isNull(crashBets.cashoutX100)))
      .orderBy(asc(crashBets.autoCashoutX100));
    const start = round.startsAt.getTime();
    this.autos = {
      roundId: round.id,
      queue: bets
        .filter((b) => b.autoCashoutX100! <= round.crashX100)
        .map((bet) => ({ bet, at: start + crashTimeFor(bet.autoCashoutX100!) })),
    };
  }

  private async payDueAutos(round: CrashRoundRow, t: number) {
    if (this.autos?.roundId !== round.id) await this.loadAutos(round);
    const queue = this.autos!.queue;
    let paid = 0;
    while (queue.length && queue[0]!.at <= t) {
      const { bet } = queue.shift()!;
      paid += await this.payAuto(bet);
    }
    if (paid) await this.crash.publishBets(round.id);
  }

  private async payAuto(bet: CrashBetRow): Promise<number> {
    try {
      const result = await this.db.transaction((tx) => this.crash.settleCashout(tx, bet, bet.autoCashoutX100!));
      await this.bus.publish({
        kind: "user",
        userId: bet.userId,
        message: { type: "crash-cashout", myBet: result.myBet, balance: result.balance },
      } satisfies LiveBusMessage);
      return 1;
    } catch {
      return 0; // already cashed out by hand
    }
  }

  private async crashRound(round: CrashRoundRow, now: Date) {
    // Any auto cash-out at or below the crash point still gets paid.
    if (this.autos?.roundId !== round.id) await this.loadAutos(round);
    for (const { bet } of this.autos!.queue.splice(0)) await this.payAuto(bet);

    const settled = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(crashRounds)
        .where(and(eq(crashRounds.id, round.id), eq(crashRounds.phase, "running")))
        .for("update");
      if (!locked) return null;
      await tx
        .update(crashBets)
        .set({ payout: 0 })
        .where(and(eq(crashBets.roundId, locked.id), isNull(crashBets.cashoutX100)));
      await tx.update(crashRounds).set({ phase: "crashed", crashedAt: now }).where(eq(crashRounds.id, locked.id));
      return tx.select().from(crashBets).where(eq(crashBets.roundId, locked.id));
    });
    this.autos = null;
    this.until = now.getTime() + CRASH_TIMING.crashedMs;
    if (!settled) return;

    await this.publishState();
    for (const bet of settled) {
      const settlement: CrashSettlementDTO = {
        roundId: round.id,
        crashX100: round.crashX100,
        staked: bet.amount,
        cashoutX100: bet.cashoutX100,
        payout: bet.payout ?? 0,
        balance: (await this.wallet.getWallet(bet.userId)).balance,
      };
      await this.bus.publish({
        kind: "user",
        userId: bet.userId,
        message: { type: "crash-settled", settlement },
      } satisfies LiveBusMessage);
    }
  }

  private async publishState() {
    const state = await this.crash.state();
    await this.bus.publish({ kind: "room", room: CRASH_ROOM, message: { type: "crash-state", state } } satisfies LiveBusMessage);
  }
}
