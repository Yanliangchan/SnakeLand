import { and, eq } from "drizzle-orm";
import {
  INSTANT_BET_LIMITS,
  MINES_MAX,
  MINES_MIN,
  MINES_TILES,
  applyX100,
  minesMultiplierX100,
  minesPositions,
  type MinesRoundDTO,
  type MinesStateDTO,
  type MinesUpdateDTO,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { minesRounds } from "../../db/schema";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE, type FairSeedService } from "../fair-seeds";

type Row = typeof minesRounds.$inferSelect;

/** Client view. Mine positions and the server seed are withheld until the round is over. */
function toDTO(row: Row): MinesRoundDTO {
  const over = row.status !== "playing";
  const safeLeft = MINES_TILES - row.mines - row.picks.length;
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    bet: row.bet,
    mines: row.mines,
    picks: row.picks,
    multiplierX100: row.multiplierX100,
    nextMultiplierX100: !over && safeLeft > 0 ? minesMultiplierX100(row.mines, row.picks.length + 1) : null,
    payout: row.payout,
    commit: row.serverSeedHash,
    minePositions: over ? minesPositions(row.serverSeed, row.clientSeed, row.mines) : null,
    bustTile: row.bustTile,
    reveal: over ? { commit: row.serverSeedHash, serverSeed: row.serverSeed, clientSeed: row.clientSeed } : null,
  };
}

export class MinesService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly seeds: FairSeedService,
  ) {}

  async state(userId: string): Promise<MinesStateDTO> {
    const [active] = await this.db
      .select()
      .from(minesRounds)
      .where(and(eq(minesRounds.userId, userId), eq(minesRounds.status, "playing")));
    return { round: active ? toDTO(active) : null, nextCommit: await this.seeds.nextCommit(userId) };
  }

  async start(userId: string, input: { bet: number; mines: number; clientSeed: string }): Promise<MinesUpdateDTO> {
    const { min, max } = INSTANT_BET_LIMITS;
    if (!Number.isSafeInteger(input.bet) || input.bet < min || input.bet > max) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${min}–${max.toLocaleString()} chips`);
    }
    if (!Number.isInteger(input.mines) || input.mines < MINES_MIN || input.mines > MINES_MAX) {
      throw new GameError(400, "INVALID_MINES", `Choose ${MINES_MIN}–${MINES_MAX} mines`);
    }
    if (!CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }

    return this.db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: minesRounds.id })
        .from(minesRounds)
        .where(and(eq(minesRounds.userId, userId), eq(minesRounds.status, "playing")));
      if (active) throw new GameError(409, "ROUND_IN_PROGRESS", "Finish your current round first");

      const seed = await this.seeds.consume(tx, userId);
      const id = crypto.randomUUID();
      const bet = await this.wallet.apply(
        { userId, amount: -input.bet, type: "bet", game: "mines", roundId: id, idempotencyKey: `${id}:bet` },
        tx,
      );
      const [row] = await tx
        .insert(minesRounds)
        .values({
          id,
          userId,
          bet: input.bet,
          mines: input.mines,
          serverSeed: seed.serverSeed,
          serverSeedHash: seed.commit,
          clientSeed: input.clientSeed,
        })
        .returning();
      return { round: toDTO(row!), balance: bet.balance, nextCommit: seed.nextCommit };
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
    if (!Number.isInteger(input.tile) || input.tile < 0 || input.tile >= MINES_TILES) {
      throw new GameError(400, "INVALID_TILE", "Pick a tile on the board");
    }
    return this.db.transaction(async (tx) => {
      const row = await this.lockRound(tx, userId, roundId, input.version);
      if (row.picks.includes(input.tile)) throw new GameError(400, "TILE_TAKEN", "That tile is already open");

      const mines = new Set(minesPositions(row.serverSeed, row.clientSeed, row.mines));
      if (mines.has(input.tile)) {
        const [saved] = await tx
          .update(minesRounds)
          .set({ status: "bust", bustTile: input.tile, payout: 0, version: row.version + 1, settledAt: new Date() })
          .where(eq(minesRounds.id, row.id))
          .returning();
        return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
      }

      const picks = [...row.picks, input.tile];
      const multiplierX100 = minesMultiplierX100(row.mines, picks.length);
      const [saved] = await tx
        .update(minesRounds)
        .set({ picks, multiplierX100, version: row.version + 1 })
        .where(eq(minesRounds.id, row.id))
        .returning();

      // Every safe tile found: nothing left to risk, so cash out automatically.
      if (picks.length === MINES_TILES - row.mines) return this.settle(tx, userId, saved!);
      return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
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
      const credit = await this.wallet.apply(
        { userId, amount: payout, type: "payout", game: "mines", roundId: row.id, idempotencyKey: `${row.id}:payout` },
        tx,
      );
      balance = credit.balance;
    }
    const [saved] = await tx
      .update(minesRounds)
      .set({ status: "cashed_out", payout, version: row.version + 1, settledAt: new Date() })
      .where(eq(minesRounds.id, row.id))
      .returning();
    return { round: toDTO(saved!), balance, nextCommit: await this.seeds.nextCommit(userId, tx) };
  }
}
