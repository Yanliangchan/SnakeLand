import { and, eq } from "drizzle-orm";
import {
  INSTANT_BET_LIMITS,
  TOWER_CONFIG,
  applyX100,
  crossingHitLane,
  isLadderMode,
  ladderLength,
  ladderMultiplierX100,
  towerLayout,
  type CrossingMode,
  type LadderGame,
  type LadderMode,
  type LadderRoundDTO,
  type LadderStateDTO,
  type LadderUpdateDTO,
  type TowerMode,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { ladderRounds } from "../../db/schema";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE, type FairSeedService } from "../fair-seeds";

type Row = typeof ladderRounds.$inferSelect;

/** Client view. The layout (Tower) or the fatal lane (Crossing) stays secret until the round ends. */
function toDTO(row: Row): LadderRoundDTO {
  const game = row.game as LadderGame;
  const mode = row.mode as LadderMode;
  const over = row.status !== "playing";
  const top = ladderLength(game, mode);
  return {
    id: row.id,
    game,
    mode,
    version: row.version,
    status: row.status,
    bet: row.bet,
    level: row.level,
    picks: row.picks,
    multiplierX100: row.multiplierX100,
    nextMultiplierX100: !over && row.level < top ? ladderMultiplierX100(game, mode, row.level + 1) : null,
    payout: row.payout,
    commit: row.serverSeedHash,
    towerLayout: over && game === "tower" ? towerLayout(row.serverSeed, row.clientSeed, mode as TowerMode) : null,
    crossingHitLane: over && game === "crossing" ? crossingHitLane(row.serverSeed, row.clientSeed, mode as CrossingMode) : null,
    reveal: over ? { commit: row.serverSeedHash, serverSeed: row.serverSeed, clientSeed: row.clientSeed } : null,
  };
}

/**
 * Tower and Crossing: climb one step at a time, each step raising the
 * multiplier; cash out any time, or lose the stake on a bad step. The
 * outcome of every step is fixed by the seeds when the round starts.
 */
export class LadderService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly seeds: FairSeedService,
  ) {}

  async state(userId: string, game: LadderGame): Promise<LadderStateDTO> {
    const [active] = await this.db
      .select()
      .from(ladderRounds)
      .where(and(eq(ladderRounds.userId, userId), eq(ladderRounds.game, game), eq(ladderRounds.status, "playing")));
    return { round: active ? toDTO(active) : null, nextCommit: await this.seeds.nextCommit(userId) };
  }

  async start(userId: string, game: LadderGame, input: { bet: number; mode: string; clientSeed: string }): Promise<LadderUpdateDTO> {
    const { min, max } = INSTANT_BET_LIMITS;
    if (!Number.isSafeInteger(input.bet) || input.bet < min || input.bet > max) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${min}–${max.toLocaleString()} chips`);
    }
    if (!isLadderMode(game, input.mode)) throw new GameError(400, "INVALID_MODE", "Unknown difficulty");
    if (!CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }
    return this.db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: ladderRounds.id })
        .from(ladderRounds)
        .where(and(eq(ladderRounds.userId, userId), eq(ladderRounds.game, game), eq(ladderRounds.status, "playing")));
      if (active) throw new GameError(409, "ROUND_IN_PROGRESS", "Finish your current round first");
      const seed = await this.seeds.consume(tx, userId);
      const id = crypto.randomUUID();
      const debit = await this.wallet.apply(
        { userId, amount: -input.bet, type: "bet", game, roundId: id, idempotencyKey: `${id}:bet` },
        tx,
      );
      const [row] = await tx
        .insert(ladderRounds)
        .values({
          id,
          userId,
          game,
          mode: input.mode,
          bet: input.bet,
          serverSeed: seed.serverSeed,
          serverSeedHash: seed.commit,
          clientSeed: input.clientSeed,
        })
        .returning();
      return { round: toDTO(row!), balance: debit.balance, nextCommit: seed.nextCommit };
    });
  }

  private async lock(tx: Tx, userId: string, game: LadderGame, roundId: string, version: number): Promise<Row> {
    const [row] = await tx
      .select()
      .from(ladderRounds)
      .where(and(eq(ladderRounds.id, roundId), eq(ladderRounds.userId, userId), eq(ladderRounds.game, game)))
      .for("update");
    if (!row) throw new GameError(404, "ROUND_NOT_FOUND", "Round not found");
    if (row.status !== "playing") throw new GameError(409, "ROUND_SETTLED", "This round is over");
    if (row.version !== version) throw new GameError(409, "STALE_VERSION", "This round changed. Refresh and try again");
    return row;
  }

  /** Take the next step. Tower needs the door picked; Crossing just hops. */
  async step(userId: string, game: LadderGame, roundId: string, input: { version: number; door?: number }): Promise<LadderUpdateDTO> {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, userId, game, roundId, input.version);
      const mode = row.mode as LadderMode;
      const top = ladderLength(game, mode);
      if (row.level >= top) throw new GameError(409, "AT_THE_TOP", "Nothing left to climb. Cash out");

      let safe: boolean;
      let picks = row.picks;
      if (game === "tower") {
        const doors = TOWER_CONFIG[mode as TowerMode].doors;
        if (!Number.isInteger(input.door) || input.door! < 0 || input.door! >= doors) {
          throw new GameError(400, "INVALID_DOOR", "Pick a door on this floor");
        }
        safe = towerLayout(row.serverSeed, row.clientSeed, mode as TowerMode)[row.level]!.includes(input.door!);
        picks = [...row.picks, input.door!];
      } else {
        safe = crossingHitLane(row.serverSeed, row.clientSeed, mode as CrossingMode) !== row.level;
      }

      if (!safe) {
        const [saved] = await tx
          .update(ladderRounds)
          .set({ status: "bust", picks, payout: 0, version: row.version + 1, settledAt: new Date() })
          .where(eq(ladderRounds.id, row.id))
          .returning();
        return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
      }

      const level = row.level + 1;
      const [saved] = await tx
        .update(ladderRounds)
        .set({ level, picks, multiplierX100: ladderMultiplierX100(game, mode, level), version: row.version + 1 })
        .where(eq(ladderRounds.id, row.id))
        .returning();
      // Reached the top: nothing left to risk, so cash out automatically.
      if (level === top) return this.settle(tx, userId, saved!);
      return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
    });
  }

  async cashOut(userId: string, game: LadderGame, roundId: string, input: { version: number }): Promise<LadderUpdateDTO> {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, userId, game, roundId, input.version);
      if (row.level === 0) throw new GameError(400, "NOTHING_TO_CASH_OUT", "Take at least one step first");
      return this.settle(tx, userId, row);
    });
  }

  private async settle(tx: Tx, userId: string, row: Row): Promise<LadderUpdateDTO> {
    const game = row.game as LadderGame;
    const payout = applyX100(row.bet, row.multiplierX100);
    const credit = await this.wallet.apply(
      { userId, amount: payout, type: "payout", game, roundId: row.id, idempotencyKey: `${row.id}:payout` },
      tx,
    );
    const [saved] = await tx
      .update(ladderRounds)
      .set({ status: "cashed_out", payout, version: row.version + 1, settledAt: new Date() })
      .where(eq(ladderRounds.id, row.id))
      .returning();
    return { round: toDTO(saved!), balance: credit.balance, nextCommit: await this.seeds.nextCommit(userId, tx) };
  }
}
