import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  BACCARAT_BETS,
  BACCARAT_RULES,
  baccaratReturn,
  hashServerSeed,
  orderedShoe,
  shuffleShoe,
  type BaccaratBets,
  type BaccaratNextTableDTO,
  type BaccaratRoundDTO,
  type BaccaratTableDTO,
  type BaccaratUpdateDTO,
  type BaccaratWinner,
  type Card,
  type RecentResult,
  type RevealedShoeDTO,
  type ShoeDTO,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { baccaratRounds, baccaratShoes, baccaratTables } from "../../db/schema";
import type { EventService, PlayCtx } from "../../events/service";
import type { ApplyInput, WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE } from "../fair-seeds";
import { dealCoup, type BaccaratHand } from "./engine";

type ShoeRow = typeof baccaratShoes.$inferSelect;
const TOTAL_CARDS = BACCARAT_RULES.decks * 52;
const CUT_POSITION = TOTAL_CARDS - BACCARAT_RULES.reserve;
const ROAD_LENGTH = 24;

const shoeDTO = (s: ShoeRow): ShoeDTO => ({
  id: s.id,
  commit: s.serverSeedHash,
  clientSeed: s.clientSeed,
  cardsRemaining: s.decks * 52 - s.position,
  totalCards: s.decks * 52,
});

const revealedDTO = (s: ShoeRow): RevealedShoeDTO => ({
  id: s.id,
  commit: s.serverSeedHash,
  serverSeed: s.serverSeed,
  clientSeed: s.clientSeed,
  decks: s.decks,
});

function roundDTO(row: { id: string; tableId: string; shoeId: string; bets: BaccaratBets; totalBet: number; totalPayout: number }, hand: BaccaratHand): BaccaratRoundDTO {
  const returns: BaccaratBets = {};
  for (const bet of BACCARAT_BETS) {
    const stake = row.bets[bet] ?? 0;
    if (stake > 0) returns[bet] = baccaratReturn(bet, stake, hand);
  }
  return {
    id: row.id,
    tableId: row.tableId,
    shoeId: row.shoeId,
    player: hand.player,
    banker: hand.banker,
    playerTotal: hand.playerTotal,
    bankerTotal: hand.bankerTotal,
    winner: hand.winner,
    natural: hand.natural,
    playerPair: hand.playerPair,
    bankerPair: hand.bankerPair,
    bets: row.bets,
    returns,
    totalBet: row.totalBet,
    totalPayout: row.totalPayout,
  };
}

/** Validate a bet slip: each placed bet is a whole number ≥ min; the total ≤ max. */
export function validateBets(bets: BaccaratBets): number {
  let total = 0;
  let count = 0;
  for (const [key, value] of Object.entries(bets)) {
    if (!(BACCARAT_BETS as readonly string[]).includes(key)) throw new GameError(400, "INVALID_BET", "Unknown bet");
    if (value === undefined || value === 0) continue;
    if (!Number.isSafeInteger(value) || value < BACCARAT_RULES.minBet) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Each bet must be at least ${BACCARAT_RULES.minBet}`);
    }
    total += value;
    count++;
  }
  if (count === 0) throw new GameError(400, "NO_BETS", "Place a bet first");
  if (total > BACCARAT_RULES.maxTotal) {
    throw new GameError(400, "BET_OUT_OF_RANGE", `Total bets are capped at ${BACCARAT_RULES.maxTotal.toLocaleString()}`);
  }
  return total;
}

/**
 * Baccarat tables. A coup is dealt and settled in a single transaction:
 * table → shoe → wallet locks, like blackjack.
 */
export class BaccaratService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly events?: EventService,
  ) {}

  /** Event tables bet against the event stack; everything else uses the wallet. */
  private funds(tx: Tx, eventId: string | null, input: ApplyInput) {
    return eventId ? this.events!.apply(tx, eventId, input) : this.wallet.apply(input, tx);
  }

  private async createShoe(tx: Tx, tableId: string, userId: string) {
    const serverSeed = randomBytes(32).toString("hex");
    const [shoe] = await tx
      .insert(baccaratShoes)
      .values({
        tableId,
        userId,
        decks: BACCARAT_RULES.decks,
        serverSeed,
        serverSeedHash: hashServerSeed(serverSeed),
        cutPosition: CUT_POSITION,
      })
      .returning();
    return shoe!;
  }

  private async lockOpenTable(tx: Tx, userId: string, eventId: string | null) {
    const [t] = await tx
      .select()
      .from(baccaratTables)
      .where(
        and(
          eq(baccaratTables.userId, userId),
          isNull(baccaratTables.closedAt),
          eventId ? eq(baccaratTables.eventId, eventId) : isNull(baccaratTables.eventId),
        ),
      )
      .for("update");
    return t ?? null;
  }

  private async openOrCreate(tx: Tx, userId: string, eventId: string | null) {
    const existing = await this.lockOpenTable(tx, userId, eventId);
    if (existing) return existing;
    const [created] = await tx.insert(baccaratTables).values({ userId, eventId }).onConflictDoNothing().returning();
    if (created) {
      await this.createShoe(tx, created.id, userId);
      return created;
    }
    const t = await this.lockOpenTable(tx, userId, eventId);
    if (!t) throw new Error("failed to open a table");
    return t;
  }

  private async liveShoe(tx: Tx, tableId: string): Promise<ShoeRow> {
    const [s] = await tx
      .select()
      .from(baccaratShoes)
      .where(and(eq(baccaratShoes.tableId, tableId), isNull(baccaratShoes.revealedAt)))
      .for("update");
    if (!s) throw new Error("table has no live shoe");
    return s;
  }

  private async tableDTO(tx: Tx, tableId: string): Promise<BaccaratTableDTO> {
    const shoe = await this.liveShoe(tx, tableId);
    const rows = await tx
      .select({ hand: baccaratRounds.hand, totalBet: baccaratRounds.totalBet, totalPayout: baccaratRounds.totalPayout })
      .from(baccaratRounds)
      .where(eq(baccaratRounds.tableId, tableId))
      .orderBy(desc(baccaratRounds.createdAt))
      .limit(ROAD_LENGTH);
    const recent = rows.slice(0, 12).map(({ totalBet, totalPayout }): RecentResult => {
      const net = totalPayout - totalBet;
      return net > 0 ? "win" : net < 0 ? "lose" : "push";
    });
    const firstNonWin = recent.findIndex((r) => r !== "win");
    return {
      id: tableId,
      shoe: shoeDTO(shoe),
      road: rows.map((r) => (r.hand as BaccaratHand).winner as BaccaratWinner),
      recent,
      streak: firstNonWin === -1 ? recent.length : firstNonWin,
    };
  }

  async getTable(userId: string, ctx: PlayCtx | null = null): Promise<BaccaratTableDTO> {
    const eventId = ctx?.eventId ?? null;
    return this.db.transaction(async (tx) => this.tableDTO(tx, (await this.openOrCreate(tx, userId, eventId)).id));
  }

  async nextTable(userId: string, ctx: PlayCtx | null = null): Promise<BaccaratNextTableDTO> {
    const eventId = ctx?.eventId ?? null;
    return this.db.transaction(async (tx) => {
      const current = await this.lockOpenTable(tx, userId, eventId);
      let revealedShoe: RevealedShoeDTO | null = null;
      if (current) {
        const shoe = await this.liveShoe(tx, current.id);
        const [revealed] = await tx
          .update(baccaratShoes)
          .set({ revealedAt: new Date() })
          .where(eq(baccaratShoes.id, shoe.id))
          .returning();
        revealedShoe = revealedDTO(revealed!);
        await tx.update(baccaratTables).set({ closedAt: new Date() }).where(eq(baccaratTables.id, current.id));
      }
      const table = await this.openOrCreate(tx, userId, eventId);
      return { table: await this.tableDTO(tx, table.id), revealedShoe };
    });
  }

  async play(
    userId: string,
    input: { tableId: string; bets: BaccaratBets; clientSeed?: string },
    ctx: PlayCtx | null = null,
  ): Promise<BaccaratUpdateDTO> {
    const eventId = ctx?.eventId ?? null;
    const totalBet = validateBets(input.bets);
    if (input.clientSeed !== undefined && !CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }
    const bets: BaccaratBets = Object.fromEntries(Object.entries(input.bets).filter(([, v]) => v && v > 0));

    return this.db.transaction(async (tx) => {
      const table = await this.lockOpenTable(tx, userId, eventId);
      if (!table || table.id !== input.tableId) throw new GameError(404, "TABLE_NOT_FOUND", "Table not found");

      let shoe = await this.liveShoe(tx, table.id);
      if (!shoe.clientSeed) {
        const [seeded] = await tx
          .update(baccaratShoes)
          .set({ clientSeed: input.clientSeed ?? randomBytes(8).toString("hex") })
          .where(eq(baccaratShoes.id, shoe.id))
          .returning();
        shoe = seeded!;
      }

      const roundId = crypto.randomUUID();
      const debit = await this.funds(tx, eventId, {
          userId,
          amount: -totalBet,
          type: "bet",
          game: "baccarat",
          tableId: table.id,
          roundId,
          idempotencyKey: `${roundId}:bet`,
          meta: { bets },
        });

      const cards: Card[] = shuffleShoe(orderedShoe(shoe.decks), shoe.serverSeed, shoe.clientSeed!);
      const shoeStart = shoe.position;
      let position = shoe.position;
      const hand = dealCoup(() => {
        const c = cards[position++];
        if (!c) throw new GameError(409, "SHOE_EXHAUSTED", "The shoe ran out of cards");
        return c;
      });

      const totalPayout = BACCARAT_BETS.reduce((s, b) => s + baccaratReturn(b, bets[b] ?? 0, hand), 0);
      let balance = debit.balance;
      if (totalPayout > 0) {
        const credit = await this.funds(tx, eventId, {
            userId,
            amount: totalPayout,
            type: "payout",
            game: "baccarat",
            tableId: table.id,
            roundId,
            idempotencyKey: `${roundId}:payout`,
          });
        balance = credit.balance;
      }

      const [row] = await tx
        .insert(baccaratRounds)
        .values({ id: roundId, tableId: table.id, shoeId: shoe.id, userId, hand, bets, shoeStart, totalBet, totalPayout })
        .returning();

      await tx.update(baccaratShoes).set({ position }).where(eq(baccaratShoes.id, shoe.id));
      let revealedShoe: RevealedShoeDTO | null = null;
      if (position >= shoe.cutPosition) {
        const [revealed] = await tx
          .update(baccaratShoes)
          .set({ revealedAt: new Date(), position })
          .where(eq(baccaratShoes.id, shoe.id))
          .returning();
        revealedShoe = revealedDTO(revealed!);
        await this.createShoe(tx, table.id, userId);
      }

      return {
        round: roundDTO({ ...row!, bets: row!.bets as BaccaratBets }, hand),
        table: await this.tableDTO(tx, table.id),
        balance,
        revealedShoe,
      };
    });
  }
}
