import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  POKER_SEATS,
  POKER_TABLES,
  hashServerSeed,
  pokerBuyIn,
  pokerRoom,
  pokerTable,
  type PokerLobbyDTO,
  type PokerMeDTO,
  type PokerPush,
  type PokerSeatDTO,
  type PokerTableDTO,
  type PokerTableId,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { pokerHands, pokerSessions, pokerTables, users } from "../../db/schema";
import type { Bus } from "../../realtime/bus";
import type { LiveBusMessage } from "../../realtime/messages";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { decide, newBot } from "./bots";
import {
  PokerRuleError,
  act,
  botResult,
  dealable,
  emptyTable,
  nextStreet,
  startHand,
  timeOut,
  type ActionInput,
  type TableState,
} from "./engine";

/** Bots sit with 100 big blinds and are topped back up below 30. */
const BOT_STACK_BB = 100;
const BOT_TOPUP_BELOW_BB = 30;

interface Cashout {
  userId: string;
  amount: number;
  balance: number;
}

interface Outcome<T> {
  value: T;
  table: TableState;
  version: number;
  changed: boolean;
  cashouts: Cashout[];
  /** Users whose own view (seat, cards) may have changed. */
  touched: Set<string>;
}

/**
 * Poker tables. All state is one locked row per table; every change (a move,
 * a bot's turn, sitting down, cashing out) happens in one transaction with
 * the wallet change it implies, then the new public state is broadcast and
 * each seated player gets their own cards privately.
 */
export class PokerService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly bus: Bus,
    private readonly clock: () => Date = () => new Date(),
    /** Injectable for tests. */
    private readonly rand: () => number = Math.random,
  ) {}

  /** Create the table rows on first start. */
  async ensureTables() {
    await this.db
      .insert(pokerTables)
      .values(POKER_TABLES.map((t) => ({ id: t.id, state: emptyTable() })))
      .onConflictDoNothing();
  }

  // ------------------------------------------------------------- reads

  async lobby(userId: string): Promise<PokerLobbyDTO> {
    const rows = await this.db.select().from(pokerTables);
    const [open] = await this.db
      .select({ tableId: pokerSessions.tableId })
      .from(pokerSessions)
      .where(and(eq(pokerSessions.userId, userId), isNull(pokerSessions.closedAt)));
    return {
      tables: POKER_TABLES.map((cfg) => {
        const t = rows.find((r) => r.id === cfg.id)?.state as TableState | undefined;
        const humans = t ? t.seats.filter((s) => s?.kind === "human").length + t.reservations.filter(Boolean).length : 0;
        return { id: cfg.id, name: cfg.name, sb: cfg.sb, bb: cfg.bb, players: humans, open: POKER_SEATS - humans };
      }),
      seatedAt: (open?.tableId as PokerTableId | undefined) ?? null,
    };
  }

  async view(tableId: PokerTableId, userId: string): Promise<{ table: PokerTableDTO; me: PokerMeDTO }> {
    await this.ensureTables();
    const [row] = await this.db.select().from(pokerTables).where(eq(pokerTables.id, tableId));
    const t = row!.state as TableState;
    return { table: publicView(tableId, t, row!.version), me: meView(tableId, t, userId) };
  }

  // ------------------------------------------------------------- the lock

  /**
   * Lock the table, let `fn` change it, save, and (after commit) broadcast.
   * `fn` returns false-y `changed` by not touching state; any throw rolls back.
   */
  private async withTable<T>(
    tableId: PokerTableId,
    fn: (tx: Tx, t: TableState, o: Pick<Outcome<T>, "cashouts" | "touched">) => Promise<{ value: T; changed: boolean }>,
  ): Promise<Outcome<T>> {
    await this.ensureTables();
    const out = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(pokerTables).where(eq(pokerTables.id, tableId)).for("update");
      const t = row!.state as TableState;
      const extra = { cashouts: [] as Cashout[], touched: new Set<string>() };
      const { value, changed } = await fn(tx, t, extra);
      let version = row!.version;
      if (changed) {
        await this.recordHand(tx, tableId, t);
        version++;
        await tx.update(pokerTables).set({ state: t, version }).where(eq(pokerTables.id, tableId));
      }
      return { value, table: t, version, changed, ...extra };
    });
    if (out.changed) await this.publish(tableId, out);
    return out;
  }

  private async publish(tableId: PokerTableId, out: Outcome<unknown>) {
    const t = out.table;
    const send = (m: LiveBusMessage) => this.bus.publish(m);
    await send({ kind: "room", room: pokerRoom(tableId), message: { type: "poker-state", table: publicView(tableId, t, out.version) } satisfies PokerPush });
    const users = new Set(out.touched);
    for (const s of t.seats) if (s?.userId) users.add(s.userId);
    for (const r of t.reservations) if (r) users.add(r.userId);
    for (const userId of users) {
      await send({ kind: "user", userId, message: { type: "poker-me", me: meView(tableId, t, userId) } satisfies PokerPush });
    }
    for (const c of out.cashouts) {
      await send({ kind: "user", userId: c.userId, message: { type: "poker-cashout", tableId, amount: c.amount, balance: c.balance } satisfies PokerPush });
    }
  }

  /** Once a hand ends, keep its seed (for verification), result, rake and the house's take. */
  private async recordHand(tx: Tx, tableId: PokerTableId, t: TableState) {
    const h = t.hand;
    if (!h || !h.ended || h.recorded) return;
    h.recorded = true;
    await tx
      .insert(pokerHands)
      .values({
        id: h.id,
        tableId,
        number: h.number,
        serverSeed: h.seed,
        serverSeedHash: h.commit,
        board: h.board,
        result: { winners: h.winners, pots: h.pots },
        rake: h.rake,
        houseNet: botResult(t, h),
        humans: h.players.filter((p) => p?.human).length,
      })
      .onConflictDoNothing();
  }

  // ------------------------------------------------------------- money in and out

  /** Return a seat's chips to its owner's wallet and close the session. */
  private async cashOut(tx: Tx, sessionId: string | null, userId: string | null, stack: number, extra: { cashouts: Cashout[]; touched: Set<string> }) {
    if (!sessionId || !userId) return;
    extra.touched.add(userId);
    const [session] = await tx
      .select()
      .from(pokerSessions)
      .where(and(eq(pokerSessions.id, sessionId), isNull(pokerSessions.closedAt)))
      .for("update");
    // Gone (a purged guest) or already closed: nothing to pay.
    if (!session) return;
    let balance: number | null = null;
    if (stack > 0) {
      const res = await this.wallet.apply(
        { userId, amount: stack, type: "table_cashout", game: "poker", roundId: sessionId, idempotencyKey: `poker:${sessionId}:out` },
        tx,
      );
      balance = res.balance;
    }
    await tx.update(pokerSessions).set({ cashOut: stack, closedAt: this.clock() }).where(eq(pokerSessions.id, sessionId));
    extra.cashouts.push({ userId, amount: stack, balance: balance ?? (await this.wallet.getWallet(userId)).balance });
  }

  /**
   * Between hands: stand up leavers and busted players (cashing them out),
   * seat players who were waiting, top bots up and fill empty seats with bots.
   */
  private async housekeep(tx: Tx, tableId: PokerTableId, t: TableState, extra: { cashouts: Cashout[]; touched: Set<string> }) {
    const { bb } = pokerTable(tableId);
    for (let i = 0; i < POKER_SEATS; i++) {
      const s = t.seats[i];
      if (!s) continue;
      if (s.kind === "human" && (s.leaving || s.stack === 0)) {
        await this.cashOut(tx, s.sessionId, s.userId, s.stack, extra);
        t.seats[i] = null;
      } else if (s.kind === "bot" && (s.leaving || s.stack === 0)) {
        t.seats[i] = null;
      } else if (s.kind === "bot" && s.stack < BOT_TOPUP_BELOW_BB * bb) {
        s.stack = BOT_STACK_BB * bb;
      }
    }
    for (let i = 0; i < POKER_SEATS; i++) {
      const r = t.reservations[i];
      if (r && !t.seats[i]) {
        t.seats[i] = { kind: "human", userId: r.userId, name: r.name, style: null, stack: r.stack, sessionId: r.sessionId, leaving: false, timeouts: 0 };
        t.reservations[i] = null;
        extra.touched.add(r.userId);
      }
    }
    for (let i = 0; i < POKER_SEATS; i++) {
      if (t.seats[i] || t.reservations[i]) continue;
      const bot = newBot(t, i, this.rand);
      t.seats[i] = { kind: "bot", userId: null, name: bot.name, style: bot.style, stack: BOT_STACK_BB * bb, sessionId: null, leaving: false, timeouts: 0 };
    }
  }

  // ------------------------------------------------------------- player requests

  async sit(user: { id: string; name: string }, tableId: PokerTableId, buyIn: number): Promise<{ me: PokerMeDTO }> {
    const range = pokerBuyIn(tableId);
    if (!Number.isSafeInteger(buyIn) || buyIn < range.min || buyIn > range.max) {
      throw new GameError(400, "BAD_BUY_IN", `Buy in for ${range.min.toLocaleString()} to ${range.max.toLocaleString()}`);
    }
    const out = await this.withTable(tableId, async (tx, t, extra) => {
      const [open] = await tx
        .select({ tableId: pokerSessions.tableId })
        .from(pokerSessions)
        .where(and(eq(pokerSessions.userId, user.id), isNull(pokerSessions.closedAt)));
      if (open) throw new GameError(409, "ALREADY_SEATED", "You're already sitting at a poker table");

      const handOn = !!t.hand && !t.hand.ended;
      const inHand = (i: number) => handOn && !!t.hand!.players[i] && !t.hand!.players[i]!.folded;
      // Prefer an empty seat; otherwise take a bot's, ideally one not in the hand.
      const empty = t.seats.findIndex((s, i) => !s && !t.reservations[i]);
      const bots = t.seats.flatMap((s, i) => (s?.kind === "bot" && !t.reservations[i] ? [i] : []));
      const botSeat = bots.find((i) => !inHand(i)) ?? bots[0];
      const seat = empty >= 0 ? empty : botSeat;
      if (seat === undefined) throw new GameError(409, "TABLE_FULL", "Every seat is taken by players. Try another table.");

      const sessionId = randomUUID();
      await tx.insert(pokerSessions).values({ id: sessionId, userId: user.id, tableId, buyIn });
      await this.wallet.apply({ userId: user.id, amount: -buyIn, type: "table_buyin", game: "poker", roundId: sessionId, idempotencyKey: `poker:${sessionId}:in` }, tx);
      extra.touched.add(user.id);

      const seated = { kind: "human" as const, userId: user.id, name: user.name, style: null, stack: buyIn, sessionId, leaving: false, timeouts: 0 };
      const occupant = t.seats[seat];
      if (!occupant || (!handOn && occupant.kind === "bot") || (occupant.kind === "bot" && !t.hand?.players[seat])) {
        // Free seat, or a bot that isn't in the current hand: take it now.
        t.seats[seat] = seated;
      } else {
        // The bot finishes this hand first.
        occupant.leaving = true;
        t.reservations[seat] = { userId: user.id, name: user.name, sessionId, stack: buyIn };
      }
      // Nothing running: start a hand straight away.
      if (!handOn) t.nextAt = null;
      return { value: undefined, changed: true };
    });
    await this.wake(tableId);
    return { me: meView(tableId, out.table, user.id) };
  }

  /** Stand up: now if not in a hand, else at the end of it (folding if it's your turn). */
  async leave(userId: string): Promise<{ me: PokerMeDTO | null; pending: boolean }> {
    const [open] = await this.db
      .select({ tableId: pokerSessions.tableId })
      .from(pokerSessions)
      .where(and(eq(pokerSessions.userId, userId), isNull(pokerSessions.closedAt)));
    if (!open) return { me: null, pending: false };
    const tableId = open.tableId as PokerTableId;
    const now = this.clock();
    const out = await this.withTable<boolean>(tableId, async (tx, t, extra) => {
      const r = t.reservations.findIndex((x) => x?.userId === userId);
      if (r >= 0) {
        const res = t.reservations[r]!;
        t.reservations[r] = null;
        const bot = t.seats[r];
        if (bot?.kind === "bot") bot.leaving = false;
        await this.cashOut(tx, res.sessionId, userId, res.stack, extra);
        return { value: false, changed: true };
      }
      const seat = t.seats.findIndex((s) => s?.userId === userId);
      if (seat < 0) {
        // A session with no seat (shouldn't happen): close it so the player isn't stuck.
        const [session] = await tx.select().from(pokerSessions).where(and(eq(pokerSessions.userId, userId), isNull(pokerSessions.closedAt)));
        if (session) await this.cashOut(tx, session.id, userId, 0, extra);
        return { value: false, changed: true };
      }
      const s = t.seats[seat]!;
      const h = t.hand;
      const playing = !!h && !h.ended && !!h.players[seat] && !h.players[seat]!.folded;
      if (playing) {
        s.leaving = true;
        if (h.toAct === seat) act(t, seat, { kind: "fold" }, now);
        return { value: true, changed: true };
      }
      await this.cashOut(tx, s.sessionId, userId, s.stack, extra);
      t.seats[seat] = null;
      return { value: false, changed: true };
    });
    await this.wake(tableId);
    return { me: meView(tableId, out.table, userId), pending: out.value };
  }

  async act(userId: string, tableId: PokerTableId, input: ActionInput): Promise<{ me: PokerMeDTO }> {
    const now = this.clock();
    const out = await this.withTable(tableId, async (_tx, t) => {
      const seat = t.seats.findIndex((s) => s?.userId === userId);
      if (seat < 0) throw new GameError(409, "NOT_SEATED", "You're not at this table");
      try {
        act(t, seat, input, now);
      } catch (e) {
        if (e instanceof PokerRuleError) throw new GameError(409, e.code, e.message);
        throw e;
      }
      return { value: undefined, changed: true };
    });
    await this.wake(tableId);
    return { me: meView(tableId, out.table, userId) };
  }

  /** A guest who signs up keeps their seat (and chips) under the new account. */
  async transferSeat(fromUserId: string, toUserId: string, name: string) {
    const [open] = await this.db
      .select({ id: pokerSessions.id, tableId: pokerSessions.tableId })
      .from(pokerSessions)
      .where(and(eq(pokerSessions.userId, fromUserId), isNull(pokerSessions.closedAt)));
    if (!open) return;
    await this.withTable(open.tableId as PokerTableId, async (tx, t, extra) => {
      await tx.update(pokerSessions).set({ userId: toUserId }).where(eq(pokerSessions.id, open.id));
      for (const s of t.seats) if (s?.userId === fromUserId) Object.assign(s, { userId: toUserId, name });
      for (const r of t.reservations) if (r?.userId === fromUserId) Object.assign(r, { userId: toUserId, name });
      extra.touched.add(toUserId);
      return { value: undefined, changed: true };
    });
  }

  private async wake(tableId: PokerTableId) {
    await this.bus.publish({ kind: "wake", room: pokerRoom(tableId) } satisfies LiveBusMessage);
  }

  // ------------------------------------------------------------- the dealer

  /**
   * One step of the table's clock, run by the dealer when `nextAt` passes:
   * a bot's move, a timeout, the next street, or (between hands) seating
   * people and dealing. Returns when it next needs attention, or null when
   * the table can sleep (nobody seated and nobody watching).
   */
  async step(tableId: PokerTableId, watched: boolean, now = this.clock()): Promise<{ nextAt: Date | null }> {
    const blinds = pokerTable(tableId);
    const out = await this.withTable(tableId, async (tx, t, extra) => {
      if (t.nextAt && now.getTime() < Date.parse(t.nextAt)) return { value: undefined, changed: false };
      const h = t.hand;
      if (h && !h.ended) {
        if (h.toAct === null) nextStreet(t, now);
        else if (t.seats[h.toAct]!.kind === "bot") {
          try {
            act(t, h.toAct, decide(t, h.toAct, this.rand), now);
          } catch {
            // A bot should never pick an illegal move, but never let one stall the table.
            const p = h.players[h.toAct]!;
            act(t, h.toAct, { kind: p.bet >= h.currentBet ? "check" : "fold" }, now);
          }
        } else if (t.seats[h.toAct]!.leaving) act(t, h.toAct, { kind: "fold" }, now);
        else if (h.deadline && now.getTime() >= Date.parse(h.deadline)) timeOut(t, now);
        else {
          t.nextAt = h.deadline;
          return { value: undefined, changed: true };
        }
        return { value: undefined, changed: true };
      }

      // Between hands.
      await this.housekeep(tx, tableId, t, extra);
      const humans = t.seats.some((s) => s?.kind === "human");
      if ((humans || watched) && dealable(t).length >= 2) {
        const seed = randomBytes(32).toString("hex");
        startHand(t, blinds, { handId: randomUUID(), seed, commit: hashServerSeed(seed) }, now);
        for (const s of t.seats) if (s?.userId) extra.touched.add(s.userId);
      } else {
        // Nothing to play: clear the felt and sleep until someone sits or watches.
        t.hand = null;
        t.nextAt = null;
      }
      return { value: undefined, changed: true };
    });
    const next = out.table.nextAt;
    return { nextAt: next ? new Date(next) : null };
  }

  /** Display names for a set of users (for seating). */
  async nameOf(userId: string): Promise<string> {
    const [u] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    return u?.name ?? "Player";
  }
}

// ------------------------------------------------------------- views

export function publicView(tableId: PokerTableId, t: TableState, version: number): PokerTableDTO {
  const cfg = pokerTable(tableId);
  const h = t.hand;
  const seats: PokerSeatDTO[] = t.seats.map((s, i) => {
    const p = h?.players[i] ?? null;
    const r = t.reservations[i];
    return {
      seat: i,
      player: s ? { kind: s.kind, userId: s.userId, name: s.name, stack: s.stack, leaving: s.leaving, sittingOut: false } : null,
      reservedFor: r ? { userId: r.userId, name: r.name } : null,
      inHand: !!p,
      folded: p?.folded ?? false,
      allIn: p?.allIn ?? false,
      bet: p?.bet ?? 0,
      // Cards are only ever public at showdown.
      shown: p && p.shown ? p.hole : null,
      holding: p && !p.folded ? p.hole.length : 0,
      lastAction: p?.lastAction ?? null,
      won: p?.won ?? null,
      handName: p?.shown ? p.handName : null,
    };
  });
  return {
    id: tableId,
    name: cfg.name,
    sb: cfg.sb,
    bb: cfg.bb,
    version,
    seats,
    players: t.seats.filter((s) => s?.kind === "human").length,
    hand: h
      ? {
          id: h.id,
          number: h.number,
          commit: h.commit,
          seed: h.ended ? h.seed : null,
          button: h.button,
          board: h.board,
          street: h.street,
          pot: h.pot,
          pots: h.ended ? h.pots : [],
          toAct: h.toAct,
          deadline: h.deadline,
          currentBet: h.currentBet,
          minRaiseTo: h.currentBet + h.minRaise,
          rake: h.rake,
          winners: h.winners,
        }
      : null,
  };
}

export function meView(tableId: PokerTableId, t: TableState, userId: string): PokerMeDTO {
  const seat = t.seats.findIndex((s) => s?.userId === userId);
  const reserved = t.reservations.findIndex((r) => r?.userId === userId);
  const p = seat >= 0 ? t.hand?.players[seat] : null;
  return {
    tableId,
    seat: seat >= 0 ? seat : null,
    reservedSeat: reserved >= 0 ? reserved : null,
    handId: p ? t.hand!.id : null,
    cards: p ? p.hole : null,
  };
}
