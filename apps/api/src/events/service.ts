import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import {
  EVENT_LIMITS,
  INSTANT_BET_LIMITS,
  MINES_DEFAULT_SIZE,
  RACE_CLIENT_SEED,
  RACE_CRASH_TARGET,
  crashPointX100,
  eventPrizes,
  hashServerSeed,
  isFfaGame,
  isMinesSize,
  minesRange,
  minesTiles,
  raceRoundSeed,
  type AdminEventInput,
  type CrashRaceResultDTO,
  type EventDetailDTO,
  type EventEntryDTO,
  type EventListDTO,
  type EventMode,
  type EventStatus,
  type EventSummaryDTO,
  type GameId,
  type RaceGame,
} from "@snakeland/shared";
import type { Db, Tx } from "../db/client";
import { eventCrashRounds, eventEntries, events, users } from "../db/schema";
import { GameError } from "../games/errors";
import type { SessionUser } from "../http/session";
import type { WalletService } from "../wallet/wallet-service";

type EventRow = typeof events.$inferSelect;
type EntryRow = typeof eventEntries.$inferSelect;

/** Which event (if any) a game request plays with. Resolved per request from the `x-snk-event` header. */
export interface PlayCtx {
  eventId: string;
  race: boolean;
}

export const EVENT_HEADER = "x-snk-event";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin-run events played with an equal "event stack" that never touches the
 * wallet until prizes are paid. Games route their bets and payouts through
 * `apply` whenever a round belongs to an event; everything else about the
 * games (limits, fairness, locking) is unchanged.
 */
export class EventService {
  /** Event mode never changes after creation, so it is safe to cache. */
  private readonly modes = new Map<string, EventMode>();

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------- status

  private effectiveStatus(e: Pick<EventRow, "status" | "startsAt" | "endsAt">, now = this.clock()): EventStatus {
    if (e.status === "ended" || e.status === "cancelled") return e.status;
    if (now < e.startsAt) return "scheduled";
    if (now < e.endsAt) return "live";
    return "ended";
  }

  private qualified(e: EventRow, entry: Pick<EntryRow, "stack" | "roundsPlayed" | "wagered">): boolean {
    const busted = entry.stack < INSTANT_BET_LIMITS.min;
    if (busted) return true;
    return e.mode === "race" ? entry.roundsPlayed >= (e.rounds ?? 0) : entry.wagered >= e.stack;
  }

  async modeOf(eventId: string): Promise<EventMode | null> {
    const cached = this.modes.get(eventId);
    if (cached) return cached;
    const [row] = await this.db.select({ mode: events.mode }).from(events).where(eq(events.id, eventId));
    if (row) this.modes.set(eventId, row.mode);
    return row?.mode ?? null;
  }

  /** Race rounds keep their outcome secret: otherwise one player could leak layouts to the rest. */
  async hidesReveal(eventId: string | null): Promise<boolean> {
    return eventId !== null && (await this.modeOf(eventId)) === "race";
  }

  /**
   * Validate the event header for a game request. Returns null for normal
   * wallet play. Throws when the header names an event the player can't use
   * with this game.
   */
  async resolve(header: unknown, userId: string, game: GameId): Promise<PlayCtx | null> {
    if (header === undefined || header === "") return null;
    if (typeof header !== "string" || !UUID_RE.test(header)) throw new GameError(400, "INVALID_EVENT", "Unknown event");
    const [row] = await this.db
      .select({ event: events, joined: eventEntries.userId })
      .from(events)
      .leftJoin(eventEntries, and(eq(eventEntries.eventId, events.id), eq(eventEntries.userId, userId)))
      .where(eq(events.id, header));
    if (!row) throw new GameError(404, "EVENT_NOT_FOUND", "Event not found");
    if (!row.joined) throw new GameError(403, "NOT_IN_EVENT", "Join the event first");
    const e = row.event;
    if (e.mode === "race" ? e.game !== game : !isFfaGame(game)) {
      throw new GameError(400, "EVENT_GAME", "This game isn't part of the event");
    }
    this.modes.set(e.id, e.mode);
    return { eventId: e.id, race: e.mode === "race" };
  }

  // ---------------------------------------------------------------- funds

  private async lockEntry(tx: Tx, eventId: string, userId: string): Promise<{ event: EventRow; entry: EntryRow }> {
    const [entry] = await tx
      .select()
      .from(eventEntries)
      .where(and(eq(eventEntries.eventId, eventId), eq(eventEntries.userId, userId)))
      .for("update");
    if (!entry) throw new GameError(403, "NOT_IN_EVENT", "Join the event first");
    const [event] = await tx.select().from(events).where(eq(events.id, eventId));
    if (this.effectiveStatus(event!) !== "live") throw new GameError(409, "EVENT_CLOSED", "This event isn't running");
    return { event: event!, entry };
  }

  /** Bet (negative) or payout (positive) against the player's event stack. */
  async apply(tx: Tx, eventId: string, input: { userId: string; amount: number }): Promise<{ balance: number }> {
    if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
      throw new GameError(400, "INVALID_AMOUNT", "Invalid amount");
    }
    const { entry } = await this.lockEntry(tx, eventId, input.userId);
    const stack = entry.stack + input.amount;
    if (stack < 0) throw new GameError(409, "INSUFFICIENT_FUNDS", "Not enough event chips");
    const wagered = input.amount < 0 ? entry.wagered - input.amount : entry.wagered;
    await tx
      .update(eventEntries)
      .set({ stack, wagered })
      .where(and(eq(eventEntries.eventId, eventId), eq(eventEntries.userId, input.userId)));
    return { balance: stack };
  }

  /**
   * The next race round for this player: counts the round and returns its
   * seed, which is identical for every entrant.
   */
  async raceSeed(tx: Tx, eventId: string, userId: string) {
    const { event, entry } = await this.lockEntry(tx, eventId, userId);
    if (event.mode !== "race") throw new GameError(400, "NOT_A_RACE", "This event isn't a race");
    const index = entry.roundsPlayed;
    if (index >= (event.rounds ?? 0)) throw new GameError(409, "RACE_DONE", "You've played all your rounds");
    await tx
      .update(eventEntries)
      .set({ roundsPlayed: index + 1 })
      .where(and(eq(eventEntries.eventId, eventId), eq(eventEntries.userId, userId)));
    const serverSeed = raceRoundSeed(event.seed, index);
    return {
      index,
      serverSeed,
      commit: hashServerSeed(serverSeed),
      clientSeed: RACE_CLIENT_SEED,
      mines: event.config?.mines ? { size: event.config.size ?? MINES_DEFAULT_SIZE, mines: event.config.mines } : null,
    };
  }

  // ---------------------------------------------------------------- crash race

  /** One Crash race round: the crash point comes from the race seed, the player picks a target. */
  async crashRace(userId: string, eventId: string, input: { bet: number; targetX100: number }): Promise<CrashRaceResultDTO> {
    const { min, max } = INSTANT_BET_LIMITS;
    if (!Number.isSafeInteger(input.bet) || input.bet < min || input.bet > max) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${min}–${max.toLocaleString()} chips`);
    }
    if (!Number.isInteger(input.targetX100) || input.targetX100 < RACE_CRASH_TARGET.min || input.targetX100 > RACE_CRASH_TARGET.max) {
      throw new GameError(400, "INVALID_TARGET", "Pick a cash-out between 1.01× and 1,000×");
    }
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, eventId));
      if (!event || event.mode !== "race" || event.game !== "crash") throw new GameError(404, "EVENT_NOT_FOUND", "Event not found");
      const seed = await this.raceSeed(tx, eventId, userId);
      await this.apply(tx, eventId, { userId, amount: -input.bet });
      const crashX100 = crashPointX100(seed.serverSeed, `${eventId}:${seed.index}`);
      const won = crashX100 >= input.targetX100;
      const payout = won ? Math.floor((input.bet * input.targetX100) / 100) : 0;
      if (payout > 0) await this.apply(tx, eventId, { userId, amount: payout });
      await tx.insert(eventCrashRounds).values({
        eventId,
        userId,
        round: seed.index,
        bet: input.bet,
        targetX100: input.targetX100,
        crashX100,
        payout,
      });
      const [entry] = await tx
        .select()
        .from(eventEntries)
        .where(and(eq(eventEntries.eventId, eventId), eq(eventEntries.userId, userId)));
      return { round: seed.index, crashX100, targetX100: input.targetX100, won, payout, entry: this.entryDTO(event, entry!, null) };
    });
  }

  // ---------------------------------------------------------------- join

  async join(user: SessionUser, eventId: string): Promise<EventEntryDTO> {
    if (user.isAnonymous) throw new GameError(403, "SIGN_UP_REQUIRED", "Create an account to join events");
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!event) throw new GameError(404, "EVENT_NOT_FOUND", "Event not found");
      const status = this.effectiveStatus(event);
      if (status !== "scheduled" && status !== "live") throw new GameError(409, "EVENT_CLOSED", "This event is over");
      const [entry] = await tx
        .insert(eventEntries)
        .values({ eventId, userId: user.id, stack: event.stack })
        .onConflictDoNothing()
        .returning();
      if (!entry) throw new GameError(409, "ALREADY_JOINED", "You're already in this event");
      if (event.buyIn > 0) {
        await this.wallet.apply(
          {
            userId: user.id,
            amount: -event.buyIn,
            type: "event_entry",
            idempotencyKey: `event:${eventId}:entry`,
            meta: { eventId, title: event.title },
          },
          tx,
        );
      }
      return this.entryDTO(event, entry, null);
    });
  }

  // ---------------------------------------------------------------- read models

  private async counts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: eventEntries.eventId, n: sql<number>`count(*)::int` })
      .from(eventEntries)
      .where(inArray(eventEntries.eventId, ids))
      .groupBy(eventEntries.eventId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private summary(e: EventRow, entrants: number): EventSummaryDTO {
    return {
      id: e.id,
      title: e.title,
      mode: e.mode,
      game: (e.game as RaceGame | null) ?? null,
      status: this.effectiveStatus(e),
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      stack: e.stack,
      buyIn: e.buyIn,
      pot: e.buyIn * entrants + e.topUp,
      rounds: e.rounds,
      mines: e.config?.mines ? { size: e.config.size ?? MINES_DEFAULT_SIZE, mines: e.config.mines } : null,
      entrants,
    };
  }

  private entryDTO(e: EventRow, entry: EntryRow, rank: number | null): EventEntryDTO {
    return {
      stack: entry.stack,
      roundsPlayed: entry.roundsPlayed,
      wagered: entry.wagered,
      qualified: this.qualified(e, entry),
      roundsLeft: e.mode === "race" ? Math.max(0, (e.rounds ?? 0) - entry.roundsPlayed) : null,
      payout: entry.payout,
      rank: entry.rank ?? rank,
    };
  }

  /** Upcoming, live and recently finished events. */
  async list(): Promise<EventListDTO> {
    await this.settleDue();
    const since = new Date(this.clock().getTime() - 7 * 24 * 3_600_000);
    const rows = await this.db
      .select()
      .from(events)
      .where(or(inArray(events.status, ["scheduled", "live"]), gte(events.endsAt, since)))
      .orderBy(desc(events.startsAt))
      .limit(30);
    const n = await this.counts(rows.map((r) => r.id));
    return { events: rows.map((r) => this.summary(r, n.get(r.id) ?? 0)) };
  }

  async detail(eventId: string, userId: string | null): Promise<EventDetailDTO> {
    const [event0] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event0) throw new GameError(404, "EVENT_NOT_FOUND", "Event not found");
    if (this.effectiveStatus(event0) === "ended" && event0.status !== "ended") await this.settle(eventId);
    const [e] = await this.db.select().from(events).where(eq(events.id, eventId));
    const event = e!;
    const rows = await this.db
      .select({ entry: eventEntries, name: users.name })
      .from(eventEntries)
      .innerJoin(users, eq(users.id, eventEntries.userId))
      .where(eq(eventEntries.eventId, eventId));

    // Final ranks once settled; otherwise a live order: qualified first, then stack.
    const ordered = [...rows].sort((a, b) =>
      a.entry.rank !== null && b.entry.rank !== null
        ? a.entry.rank - b.entry.rank
        : Number(this.qualified(event, b.entry)) - Number(this.qualified(event, a.entry)) || b.entry.stack - a.entry.stack,
    );
    const standings = ordered.slice(0, 100).map((r, i) => ({
      rank: r.entry.rank ?? i + 1,
      userId: r.entry.userId,
      name: r.name,
      stack: r.entry.stack,
      roundsPlayed: r.entry.roundsPlayed,
      wagered: r.entry.wagered,
      qualified: this.qualified(event, r.entry),
      payout: r.entry.payout,
    }));
    const mineIdx = userId ? ordered.findIndex((r) => r.entry.userId === userId) : -1;
    const status = this.effectiveStatus(event);
    const over = status === "ended" || status === "cancelled";
    return {
      ...this.summary(event, rows.length),
      commit: event.mode === "race" ? event.seedHash : null,
      seed: event.mode === "race" && over ? event.seed : null,
      standings,
      me: mineIdx >= 0 ? this.entryDTO(event, ordered[mineIdx]!.entry, mineIdx + 1) : null,
      canJoin: mineIdx < 0 && (status === "scheduled" || status === "live"),
      serverNow: this.clock().toISOString(),
    };
  }

  // ---------------------------------------------------------------- settlement

  /** Settle every event whose window has closed. Safe to call from any instance. */
  async settleDue(): Promise<number> {
    const due = await this.db
      .select({ id: events.id })
      .from(events)
      .where(and(inArray(events.status, ["scheduled", "live"]), lte(events.endsAt, this.clock())));
    for (const { id } of due) await this.settle(id);
    return due.length;
  }

  /**
   * Rank entrants and pay the pot: 50/30/20 between the top three qualified
   * players, ties sharing their places. Idempotent (row lock + status check,
   * and one idempotency key per prize).
   */
  async settle(eventId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!event || event.status === "ended" || event.status === "cancelled") return;
      if (this.effectiveStatus(event) !== "ended") return;
      const entries = await tx.select().from(eventEntries).where(eq(eventEntries.eventId, eventId)).for("update");
      const ranked = [...entries].sort(
        (a, b) =>
          Number(this.qualified(event, b)) - Number(this.qualified(event, a)) ||
          b.stack - a.stack ||
          a.joinedAt.getTime() - b.joinedAt.getTime(),
      );
      const winners = ranked.filter((r) => this.qualified(event, r));
      const pot = event.buyIn * entries.length + event.topUp;
      const prizes = eventPrizes(
        winners.map((w) => w.stack),
        pot,
      );
      let rank = 0;
      for (const [i, entry] of ranked.entries()) {
        const q = i < winners.length;
        // Tied qualified players share a place (1, 2, 2, 4…).
        const tied = i > 0 && q && ranked[i - 1]!.stack === entry.stack;
        if (!tied) rank = i + 1;
        const payout = q ? prizes[i]! : 0;
        if (payout > 0) {
          await this.wallet.apply(
            {
              userId: entry.userId,
              amount: payout,
              type: "event_prize",
              idempotencyKey: `event:${eventId}:prize`,
              meta: { eventId, title: event.title, rank },
            },
            tx,
          );
        }
        await tx
          .update(eventEntries)
          .set({ rank, payout })
          .where(and(eq(eventEntries.eventId, eventId), eq(eventEntries.userId, entry.userId)));
      }
      await tx.update(events).set({ status: "ended", settledAt: this.clock() }).where(eq(events.id, eventId));
    });
  }

  // ---------------------------------------------------------------- admin

  async adminList(): Promise<EventSummaryDTO[]> {
    await this.settleDue();
    const rows = await this.db.select().from(events).orderBy(desc(events.createdAt)).limit(100);
    const n = await this.counts(rows.map((r) => r.id));
    return rows.map((r) => this.summary(r, n.get(r.id) ?? 0));
  }

  async create(input: AdminEventInput): Promise<string> {
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new GameError(400, "INVALID_START", "Pick a start time");
    const { minutes, stack, buyIn, topUp, rounds } = EVENT_LIMITS;
    if (!Number.isInteger(input.minutes) || input.minutes < minutes.min || input.minutes > minutes.max) {
      throw new GameError(400, "INVALID_DURATION", "Pick a duration");
    }
    if (input.stack < stack.min || input.stack > stack.max) throw new GameError(400, "INVALID_STACK", "Invalid stack");
    if (input.buyIn < 0 || input.buyIn > buyIn.max || input.topUp < 0 || input.topUp > topUp.max) {
      throw new GameError(400, "INVALID_POT", "Invalid buy-in or top-up");
    }
    let config: { size?: number; mines?: number } | null = null;
    if (input.mode === "race") {
      if (!input.game) throw new GameError(400, "INVALID_GAME", "Pick the race game");
      if (!input.rounds || input.rounds < rounds.min || input.rounds > rounds.max) {
        throw new GameError(400, "INVALID_ROUNDS", `Races are ${rounds.min}–${rounds.max} rounds`);
      }
      if (input.game === "mines") {
        const m = input.mines ?? { size: MINES_DEFAULT_SIZE, mines: 3 };
        const range = isMinesSize(m.size) ? minesRange(minesTiles(m.size)) : null;
        if (!range || m.mines < range.min || m.mines > range.max) throw new GameError(400, "INVALID_MINES", "Invalid board");
        config = { size: m.size, mines: m.mines };
      }
    }
    const seed = randomBytes(32).toString("hex");
    const [row] = await this.db
      .insert(events)
      .values({
        title: input.title,
        mode: input.mode,
        game: input.mode === "race" ? input.game : null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.minutes * 60_000),
        stack: input.stack,
        buyIn: input.buyIn,
        topUp: input.topUp,
        rounds: input.mode === "race" ? input.rounds : null,
        config,
        seed,
        seedHash: hashServerSeed(seed),
      })
      .returning({ id: events.id });
    return row!.id;
  }

  /** Cancel before it's settled: everyone gets their buy-in back. */
  async cancel(eventId: string): Promise<{ refunded: number }> {
    return this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!event) throw new GameError(404, "EVENT_NOT_FOUND", "Event not found");
      if (event.status === "ended" || event.status === "cancelled") throw new GameError(409, "EVENT_CLOSED", "This event is already over");
      const entries = await tx.select({ userId: eventEntries.userId }).from(eventEntries).where(eq(eventEntries.eventId, eventId));
      if (event.buyIn > 0) {
        for (const { userId } of entries) {
          await this.wallet.apply(
            { userId, amount: event.buyIn, type: "event_refund", idempotencyKey: `event:${eventId}:refund`, meta: { eventId } },
            tx,
          );
        }
      }
      await tx.update(events).set({ status: "cancelled", settledAt: this.clock() }).where(eq(events.id, eventId));
      return { refunded: event.buyIn > 0 ? entries.length : 0 };
    });
  }
}
