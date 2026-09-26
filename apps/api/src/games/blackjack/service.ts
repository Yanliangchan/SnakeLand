import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  BLACKJACK_RULES,
  hashServerSeed,
  orderedShoe,
  shuffleShoe,
  type BlackjackAction,
  type BlackjackTableDTO,
  type BlackjackUpdateDTO,
  type Card,
  type NextTableDTO,
  type RecentResult,
  type RevealedShoeDTO,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { blackjackRounds, blackjackShoes, blackjackTables } from "../../db/schema";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { act, deal, totalPayout, totalStaked, type EngineState } from "./engine";
import { CUT_POSITION, toRevealedShoeDTO, toRoundDTO, toShoeDTO } from "./dto";

type ShoeRow = typeof blackjackShoes.$inferSelect;
type RoundRow = typeof blackjackRounds.$inferSelect;

export const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RECENT_LIMIT = 12;

/** Cards come off a shoe strictly in its committed order. */
function shoeDrawer(shoe: ShoeRow) {
  if (!shoe.clientSeed) throw new Error("shoe has not been seeded");
  const cards = shuffleShoe(orderedShoe(shoe.decks), shoe.serverSeed, shoe.clientSeed);
  let position = shoe.position;
  return {
    draw: (): Card => {
      const card = cards[position];
      if (!card) throw new GameError(409, "SHOE_EXHAUSTED", "The shoe ran out of cards");
      position++;
      return card;
    },
    position: () => position,
  };
}

/**
 * Blackjack table/round orchestration. Every request is one DB transaction;
 * locks are always taken in the order table|round → shoe → wallet.
 */
export class BlackjackService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
  ) {}

  // ---------------------------------------------------------------- tables

  private async createShoe(tx: Tx, tableId: string, userId: string): Promise<ShoeRow> {
    const serverSeed = randomBytes(32).toString("hex");
    const [shoe] = await tx
      .insert(blackjackShoes)
      .values({
        tableId,
        userId,
        decks: BLACKJACK_RULES.decks,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed),
        cutPosition: CUT_POSITION,
      })
      .returning();
    return shoe!;
  }

  private async lockOpenTable(tx: Tx, userId: string) {
    const [table] = await tx
      .select()
      .from(blackjackTables)
      .where(and(eq(blackjackTables.userId, userId), isNull(blackjackTables.closedAt)))
      .for("update");
    return table ?? null;
  }

  private async openOrCreateTable(tx: Tx, userId: string) {
    const existing = await this.lockOpenTable(tx, userId);
    if (existing) return existing;
    // ON CONFLICT covers a concurrent request creating the table first.
    const [created] = await tx.insert(blackjackTables).values({ userId }).onConflictDoNothing().returning();
    if (created) {
      await this.createShoe(tx, created.id, userId);
      return created;
    }
    const table = await this.lockOpenTable(tx, userId);
    if (!table) throw new Error("failed to open a table");
    return table;
  }

  private async liveShoe(tx: Tx, tableId: string): Promise<ShoeRow> {
    const [shoe] = await tx
      .select()
      .from(blackjackShoes)
      .where(and(eq(blackjackShoes.tableId, tableId), isNull(blackjackShoes.revealedAt)))
      .for("update");
    if (!shoe) throw new Error("table has no live shoe");
    return shoe;
  }

  private async recent(tx: Tx, tableId: string): Promise<{ recent: RecentResult[]; streak: number }> {
    const rows = await tx
      .select({ totalBet: blackjackRounds.totalBet, totalPayout: blackjackRounds.totalPayout })
      .from(blackjackRounds)
      .where(and(eq(blackjackRounds.tableId, tableId), eq(blackjackRounds.status, "settled")))
      .orderBy(desc(blackjackRounds.createdAt))
      .limit(RECENT_LIMIT);
    const recent = rows.map(({ totalBet, totalPayout }): RecentResult => {
      const net = (totalPayout ?? 0) - totalBet;
      return net > 0 ? "win" : net < 0 ? "lose" : "push";
    });
    const firstNonWin = recent.findIndex((r) => r !== "win");
    return { recent, streak: firstNonWin === -1 ? recent.length : firstNonWin };
  }

  private async tableDTO(tx: Tx, table: { id: string }): Promise<BlackjackTableDTO> {
    const shoe = await this.liveShoe(tx, table.id);
    const [active] = await tx
      .select()
      .from(blackjackRounds)
      .where(and(eq(blackjackRounds.tableId, table.id), eq(blackjackRounds.status, "in_progress")));
    return {
      id: table.id,
      shoe: toShoeDTO(shoe),
      round: active ? toRoundDTO(active, active.state as EngineState) : null,
      ...(await this.recent(tx, table.id)),
    };
  }

  /** The user's open table (resuming any hand in progress), creating one if needed. */
  async getTable(userId: string): Promise<BlackjackTableDTO> {
    return this.db.transaction(async (tx) => this.tableDTO(tx, await this.openOrCreateTable(tx, userId)));
  }

  /** Leave the current table: its shoe is revealed and a fresh table + shoe is opened. */
  async nextTable(userId: string): Promise<NextTableDTO> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockOpenTable(tx, userId);
      let revealedShoe: RevealedShoeDTO | null = null;
      if (current) {
        const [active] = await tx
          .select({ id: blackjackRounds.id })
          .from(blackjackRounds)
          .where(and(eq(blackjackRounds.tableId, current.id), eq(blackjackRounds.status, "in_progress")));
        if (active) throw new GameError(409, "ROUND_IN_PROGRESS", "Finish your hand before leaving the table");
        const shoe = await this.liveShoe(tx, current.id);
        const [revealed] = await tx
          .update(blackjackShoes)
          .set({ revealedAt: new Date() })
          .where(eq(blackjackShoes.id, shoe.id))
          .returning();
        revealedShoe = toRevealedShoeDTO(revealed!);
        await tx.update(blackjackTables).set({ closedAt: new Date() }).where(eq(blackjackTables.id, current.id));
      }
      const table = await this.openOrCreateTable(tx, userId);
      return { table: await this.tableDTO(tx, table), revealedShoe };
    });
  }

  /** Public details of a shoe the user played; the seed only once it is revealed. */
  async getShoe(userId: string, shoeId: string) {
    const [shoe] = await this.db
      .select()
      .from(blackjackShoes)
      .where(and(eq(blackjackShoes.id, shoeId), eq(blackjackShoes.userId, userId)));
    if (!shoe) throw new GameError(404, "NOT_FOUND", "Shoe not found");
    return shoe.revealedAt ? { revealed: true as const, ...toRevealedShoeDTO(shoe) } : { revealed: false as const, ...toShoeDTO(shoe) };
  }

  // ---------------------------------------------------------------- rounds

  async startRound(
    userId: string,
    input: { tableId: string; bet: number; clientSeed?: string },
  ): Promise<BlackjackUpdateDTO> {
    const { minBet, maxBet } = BLACKJACK_RULES;
    if (!Number.isSafeInteger(input.bet) || input.bet < minBet || input.bet > maxBet) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${minBet}–${maxBet.toLocaleString()} chips`);
    }
    if (input.clientSeed !== undefined && !CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }

    return this.db.transaction(async (tx) => {
      const table = await this.lockOpenTable(tx, userId);
      if (!table || table.id !== input.tableId) throw new GameError(404, "TABLE_NOT_FOUND", "Table not found");

      const [active] = await tx
        .select({ id: blackjackRounds.id })
        .from(blackjackRounds)
        .where(and(eq(blackjackRounds.tableId, table.id), eq(blackjackRounds.status, "in_progress")));
      if (active) throw new GameError(409, "ROUND_IN_PROGRESS", "A hand is already in play");

      let shoe = await this.liveShoe(tx, table.id);
      if (!shoe.clientSeed) {
        // The client seed is fixed on the shoe's first deal, after its server seed was committed.
        const clientSeed = input.clientSeed ?? randomBytes(8).toString("hex");
        const [seeded] = await tx
          .update(blackjackShoes)
          .set({ clientSeed })
          .where(eq(blackjackShoes.id, shoe.id))
          .returning();
        shoe = seeded!;
      }

      const roundId = randomUUID();
      const bet = await this.wallet.apply(
        {
          userId,
          amount: -input.bet,
          type: "bet",
          game: "blackjack",
          tableId: table.id,
          roundId,
          idempotencyKey: `${roundId}:bet:0`,
        },
        tx,
      );

      const drawer = shoeDrawer(shoe);
      const shoeStart = drawer.position();
      const state = deal(input.bet, drawer.draw);

      const [row] = await tx
        .insert(blackjackRounds)
        .values({
          id: roundId,
          tableId: table.id,
          shoeId: shoe.id,
          userId,
          state,
          shoeStart,
          totalBet: input.bet,
        })
        .returning();

      return this.persist(tx, userId, row!, shoe, state, drawer.position(), bet.balance);
    });
  }

  async act(
    userId: string,
    roundId: string,
    input: { action: BlackjackAction; version: number },
  ): Promise<BlackjackUpdateDTO> {
    return this.db.transaction(async (tx) => {
      const [round] = await tx
        .select()
        .from(blackjackRounds)
        .where(and(eq(blackjackRounds.id, roundId), eq(blackjackRounds.userId, userId)))
        .for("update");
      if (!round) throw new GameError(404, "ROUND_NOT_FOUND", "Hand not found");
      if (round.status !== "in_progress") throw new GameError(409, "ROUND_SETTLED", "This hand is over");
      if (round.version !== input.version) {
        throw new GameError(409, "STALE_VERSION", "This hand changed. Refresh and try again");
      }

      const [shoe] = await tx.select().from(blackjackShoes).where(eq(blackjackShoes.id, round.shoeId)).for("update");
      if (!shoe) throw new Error("round has no shoe");
      const drawer = shoeDrawer(shoe);
      const result = act(round.state as EngineState, input.action, drawer.draw);

      let balance: number | null = null;
      if (result.debit > 0) {
        const debit = await this.wallet.apply(
          {
            userId,
            amount: -result.debit,
            type: "bet",
            game: "blackjack",
            tableId: round.tableId,
            roundId: round.id,
            idempotencyKey: `${round.id}:bet:${round.version}`,
            meta: { action: input.action },
          },
          tx,
        );
        balance = debit.balance;
      }
      return this.persist(tx, userId, round, shoe, result.state, drawer.position(), balance);
    });
  }

  /** Save round + shoe position; on settlement pay out and reshuffle a spent shoe. */
  private async persist(
    tx: Tx,
    userId: string,
    round: RoundRow,
    shoe: ShoeRow,
    state: EngineState,
    position: number,
    balance: number | null,
  ): Promise<BlackjackUpdateDTO> {
    const settled = state.phase === "settled";
    const payout = settled ? totalPayout(state) : null;
    const totalBet = totalStaked(state);

    if (payout) {
      const credit = await this.wallet.apply(
        {
          userId,
          amount: payout,
          type: "payout",
          game: "blackjack",
          tableId: round.tableId,
          roundId: round.id,
          idempotencyKey: `${round.id}:payout`,
        },
        tx,
      );
      balance = credit.balance;
    }

    const [saved] = await tx
      .update(blackjackRounds)
      .set({
        state,
        version: round.version + 1,
        totalBet,
        totalPayout: payout,
        status: settled ? "settled" : "in_progress",
        settledAt: settled ? new Date() : null,
      })
      .where(eq(blackjackRounds.id, round.id))
      .returning();

    let [liveShoe] = await tx
      .update(blackjackShoes)
      .set({ position })
      .where(eq(blackjackShoes.id, shoe.id))
      .returning();

    // Past the cut card: reveal this shoe and bring a fresh one for the next hand.
    let revealedShoe: RevealedShoeDTO | null = null;
    if (settled && position >= liveShoe!.cutPosition) {
      const [revealed] = await tx
        .update(blackjackShoes)
        .set({ revealedAt: new Date() })
        .where(eq(blackjackShoes.id, shoe.id))
        .returning();
      revealedShoe = toRevealedShoeDTO(revealed!);
      liveShoe = await this.createShoe(tx, round.tableId, userId);
    }

    return {
      round: toRoundDTO(saved!, state),
      shoe: toShoeDTO(liveShoe!),
      ...(await this.recent(tx, round.tableId)),
      balance,
      revealedShoe,
    };
  }
}
