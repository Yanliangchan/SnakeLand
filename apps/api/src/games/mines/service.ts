import { and, eq, isNull } from "drizzle-orm";
import {
  INSTANT_BET_LIMITS,
  MINES_DEFAULT_SIZE,
  isMinesSize,
  minesRange,
  minesTiles,
  applyX100,
  minesMultiplierX100,
  minesPositions,
  type MinesRoundDTO,
  type MinesStateDTO,
  type MinesUpdateDTO,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { minesRounds } from "../../db/schema";
import type { EventService, PlayCtx } from "../../events/service";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE, type FairSeedService } from "../fair-seeds";

type Row = typeof minesRounds.$inferSelect;

/**
 * Client view. Mine positions and the server seed are withheld until the
 * round is over (and, in a race, until the event is over).
 */
function toDTO(row: Row, hide = false): MinesRoundDTO {
  const over = row.status !== "playing" && !hide;
  const tiles = minesTiles(row.size);
  const safeLeft = tiles - row.mines - row.picks.length;
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    bet: row.bet,
    size: row.size,
    mines: row.mines,
    picks: row.picks,
    multiplierX100: row.multiplierX100,
    nextMultiplierX100: row.status === "playing" && safeLeft > 0 ? minesMultiplierX100(tiles, row.mines, row.picks.length + 1) : null,
    payout: row.payout,
    commit: row.serverSeedHash,
    minePositions: over ? minesPositions(row.serverSeed, row.clientSeed, tiles, row.mines) : null,
    bustTile: row.bustTile,
    reveal: over ? { commit: row.serverSeedHash, serverSeed: row.serverSeed, clientSeed: row.clientSeed } : null,
  };
}

export class MinesService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly seeds: FairSeedService,
    private readonly events?: EventService,
  ) {}

  /** Bets and payouts go to the event stack for event rounds, otherwise the wallet. */
  private async funds(tx: Tx, eventId: string | null, input: { userId: string; amount: number; roundId: string; key: string }) {
    if (eventId) return this.events!.apply(tx, eventId, input);
    const type = input.amount < 0 ? "bet" : "payout";
    return this.wallet.apply({ userId: input.userId, amount: input.amount, type, game: "mines", roundId: input.roundId, idempotencyKey: input.key }, tx);
  }

  private dto = async (row: Row) => toDTO(row, await this.events?.hidesReveal(row.eventId ?? null));

  async state(userId: string, ctx: PlayCtx | null = null): Promise<MinesStateDTO> {
    const [active] = await this.db
      .select()
      .from(minesRounds)
      .where(
        and(
          eq(minesRounds.userId, userId),
          eq(minesRounds.status, "playing"),
          ctx ? eq(minesRounds.eventId, ctx.eventId) : isNull(minesRounds.eventId),
        ),
      );
    return { round: active ? await this.dto(active) : null, nextCommit: await this.seeds.nextCommit(userId) };
  }

  async start(
    userId: string,
    input: { bet: number; size?: number; mines: number; clientSeed: string },
    ctx: PlayCtx | null = null,
  ): Promise<MinesUpdateDTO> {
    const size = input.size ?? MINES_DEFAULT_SIZE;
    if (!isMinesSize(size)) throw new GameError(400, "INVALID_SIZE", "Choose a board from 3×3 to 8×8");
    const range = minesRange(minesTiles(size));
    const { min, max } = INSTANT_BET_LIMITS;
    if (!Number.isSafeInteger(input.bet) || input.bet < min || input.bet > max) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${min}–${max.toLocaleString()} chips`);
    }
    if (!Number.isInteger(input.mines) || input.mines < range.min || input.mines > range.max) {
      throw new GameError(400, "INVALID_MINES", `Choose ${range.min}–${range.max} mines on this board`);
    }
    if (!CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }

    return this.db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: minesRounds.id })
        .from(minesRounds)
        .where(
          and(
            eq(minesRounds.userId, userId),
            eq(minesRounds.status, "playing"),
            ctx ? eq(minesRounds.eventId, ctx.eventId) : isNull(minesRounds.eventId),
          ),
        );
      if (active) throw new GameError(409, "ROUND_IN_PROGRESS", "Finish your current round first");

      // A race hands every player the same seed (and board) for the same round.
      let board = { size, mines: input.mines };
      let seed: { serverSeed: string; commit: string; clientSeed: string };
      if (ctx?.race) {
        const race = await this.events!.raceSeed(tx, ctx.eventId, userId);
        if (race.mines) board = race.mines;
        seed = race;
      } else {
        seed = { ...(await this.seeds.consume(tx, userId)), clientSeed: input.clientSeed };
      }
      const id = crypto.randomUUID();
      const bet = await this.funds(tx, ctx?.eventId ?? null, { userId, amount: -input.bet, roundId: id, key: `${id}:bet` });
      const [row] = await tx
        .insert(minesRounds)
        .values({
          id,
          userId,
          eventId: ctx?.eventId ?? null,
          bet: input.bet,
          size: board.size,
          mines: board.mines,
          serverSeed: seed.serverSeed,
          serverSeedHash: seed.commit,
          clientSeed: seed.clientSeed,
        })
        .returning();
      return { round: await this.dto(row!), balance: bet.balance, nextCommit: await this.seeds.nextCommit(userId, tx) };
    });
  }

  private async lockRound(tx: Tx, userId: string, roundId: string, version: number): Promise<Row> {
    const [row] = await tx
      .select()
      .from(minesRounds)
      .where(and(eq(minesRounds.id, roundId), eq(minesRounds.userId, userId)))
      .for("update");
    if (!row) throw new GameError(404, "ROUND_NOT_FOUND", "Round not found");
    if (row.status !== "playing") throw new GameError(409, "ROUND_SETTLED", "This round is over");
    if (row.version !== version) throw new GameError(409, "STALE_VERSION", "This round changed. Refresh and try again");
    return row;
  }

  async reveal(userId: string, roundId: string, input: { tile: number; version: number }): Promise<MinesUpdateDTO> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockRound(tx, userId, roundId, input.version);
      const tiles = minesTiles(row.size);
      if (!Number.isInteger(input.tile) || input.tile < 0 || input.tile >= tiles) {
        throw new GameError(400, "INVALID_TILE", "Pick a tile on the board");
      }
      if (row.picks.includes(input.tile)) throw new GameError(400, "TILE_TAKEN", "That tile is already open");

      const mines = new Set(minesPositions(row.serverSeed, row.clientSeed, tiles, row.mines));
      if (mines.has(input.tile)) {
        const [saved] = await tx
          .update(minesRounds)
          .set({ status: "bust", bustTile: input.tile, payout: 0, version: row.version + 1, settledAt: new Date() })
          .where(eq(minesRounds.id, row.id))
          .returning();
        return { round: await this.dto(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
      }

      const picks = [...row.picks, input.tile];
      const multiplierX100 = minesMultiplierX100(tiles, row.mines, picks.length);
      const [saved] = await tx
        .update(minesRounds)
        .set({ picks, multiplierX100, version: row.version + 1 })
        .where(eq(minesRounds.id, row.id))
        .returning();

      // Every safe tile found: nothing left to risk, so cash out automatically.
      if (picks.length === tiles - row.mines) return this.settle(tx, userId, saved!);
      return { round: await this.dto(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
    });
  }

  async cashOut(userId: string, roundId: string, input: { version: number }): Promise<MinesUpdateDTO> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockRound(tx, userId, roundId, input.version);
      if (row.picks.length === 0) throw new GameError(400, "NOTHING_TO_CASH_OUT", "Open at least one tile first");
      return this.settle(tx, userId, row);
    });
  }

  private async settle(tx: Tx, userId: string, row: Row): Promise<MinesUpdateDTO> {
    const payout = applyX100(row.bet, row.multiplierX100);
    let balance: number | null = null;
    if (payout > 0) {
      const credit = await this.funds(tx, row.eventId, { userId, amount: payout, roundId: row.id, key: `${row.id}:payout` });
      balance = credit.balance;
    }
    const [saved] = await tx
      .update(minesRounds)
      .set({ status: "cashed_out", payout, version: row.version + 1, settledAt: new Date() })
      .where(eq(minesRounds.id, row.id))
      .returning();
    return { round: await this.dto(saved!), balance, nextCommit: await this.seeds.nextCommit(userId, tx) };
  }
}
