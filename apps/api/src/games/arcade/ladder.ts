import { and, eq } from "drizzle-orm";
import {
  HILO_CHOICES,
  HILO_MAX_STEPS,
  INSTANT_BET_LIMITS,
  PENALTY_CONFIG,
  TOWER_CONFIG,
  applyX100,
  crossingHitLane,
  hiloCards,
  hiloMultiplierX100,
  hiloNextX100,
  hiloWins,
  isLadderMode,
  ladderLength,
  ladderMultiplierX100,
  penaltyKeeper,
  towerLayout,
  type CrossingMode,
  type HiloChoice,
  type LadderGame,
  type LadderMode,
  type LadderRoundDTO,
  type LadderStateDTO,
  type LadderUpdateDTO,
  type PenaltyMode,
  type TowerMode,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import { ladderRounds } from "../../db/schema";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE, type FairSeedService } from "../fair-seeds";

type Row = typeof ladderRounds.$inferSelect;

const hiloPicks = (picks: number[]): HiloChoice[] => picks.map((p) => HILO_CHOICES[p]!);

/**
 * Client view. Anything still ahead of the player (the Tower layout, the
 * fatal lane, the keeper's next dives, the next card) stays secret until the
 * round ends.
 */
function toDTO(row: Row): LadderRoundDTO {
  const game = row.game as LadderGame;
  const mode = row.mode as LadderMode;
  const over = row.status !== "playing";
  const top = ladderLength(game, mode);
  const cards = game === "hilo" ? hiloCards(row.serverSeed, row.clientSeed) : null;
  // Hi-Lo: every card seen so far, the current (or losing) card last.
  const seen = cards ? cards.slice(0, row.picks.length + 1) : null;
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
    nextMultiplierX100:
      game !== "hilo" && !over && row.level < top ? ladderMultiplierX100(game, mode, row.level + 1) : null,
    payout: row.payout,
    commit: row.serverSeedHash,
    towerLayout: over && game === "tower" ? towerLayout(row.serverSeed, row.clientSeed, mode as TowerMode) : null,
    crossingHitLane: over && game === "crossing" ? crossingHitLane(row.serverSeed, row.clientSeed, mode as CrossingMode) : null,
    penaltyKeeper:
      game === "penalty"
        ? penaltyKeeper(row.serverSeed, row.clientSeed, mode as PenaltyMode).slice(0, over ? undefined : row.picks.length)
        : null,
    hiloCards: seen,
    hiloNext: cards && !over ? hiloNextX100(cards, hiloPicks(row.picks), seen!.at(-1)!) : null,
    reveal: over ? { commit: row.serverSeedHash, serverSeed: row.serverSeed, clientSeed: row.clientSeed } : null,
  };
}

/**
 * Tower, Crossing, Penalty and Hi-Lo: climb one step at a time, each step raising the
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

  /**
   * Take the next step. Tower needs a door and Penalty a spot (`door`);
   * Hi-Lo needs a guess (`choice`); Crossing just hops.
   */
  async step(
    userId: string,
    game: LadderGame,
    roundId: string,
    input: { version: number; door?: number; choice?: HiloChoice },
  ): Promise<LadderUpdateDTO> {
    if (game === "hilo") return this.hiloStep(userId, roundId, input);
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
      } else if (game === "penalty") {
        const spots = PENALTY_CONFIG[mode as PenaltyMode].spots;
        if (!Number.isInteger(input.door) || input.door! < 0 || input.door! >= spots) {
          throw new GameError(400, "INVALID_SPOT", "Pick a spot in the goal");
        }
        safe = !penaltyKeeper(row.serverSeed, row.clientSeed, mode as PenaltyMode)[row.level]!.includes(input.door!);
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

  /**
   * Hi-Lo: guess whether the next card is higher-or-same or lower-or-same,
   * or skip it. `level` counts correct guesses; the round ends after
   * HILO_MAX_STEPS cards, and the last one can't be skipped.
   */
  private async hiloStep(userId: string, roundId: string, input: { version: number; choice?: HiloChoice }) {
    const choice = input.choice;
    if (!choice || !HILO_CHOICES.includes(choice)) throw new GameError(400, "INVALID_CHOICE", "Pick higher, lower or skip");
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, userId, "hilo", roundId, input.version);
      const step = row.picks.length;
      if (step >= HILO_MAX_STEPS) throw new GameError(409, "AT_THE_TOP", "No cards left. Cash out");
      const cards = hiloCards(row.serverSeed, row.clientSeed);
      const history = hiloPicks(row.picks);
      const picks = [...row.picks, HILO_CHOICES.indexOf(choice)];

      if (choice === "skip") {
        if (step === HILO_MAX_STEPS - 1) throw new GameError(400, "NO_SKIP", "The last card can't be skipped");
        const [saved] = await tx
          .update(ladderRounds)
          .set({ picks, version: row.version + 1 })
          .where(eq(ladderRounds.id, row.id))
          .returning();
        return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
      }

      // A guess that can't raise the multiplier (higher on an ace) is refused.
      if (hiloNextX100(cards, history, cards[step]!)[choice] === null) {
        throw new GameError(400, "NO_GAIN", "That guess can't win anything. Pick the other or skip");
      }
      if (!hiloWins(cards[step]!, cards[step + 1]!, choice)) {
        const [saved] = await tx
          .update(ladderRounds)
          .set({ status: "bust", picks, payout: 0, version: row.version + 1, settledAt: new Date() })
          .where(eq(ladderRounds.id, row.id))
          .returning();
        return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
      }
      const [saved] = await tx
        .update(ladderRounds)
        .set({
          level: row.level + 1,
          picks,
          multiplierX100: hiloMultiplierX100(cards, [...history, choice]),
          version: row.version + 1,
        })
        .where(eq(ladderRounds.id, row.id))
        .returning();
      if (picks.length === HILO_MAX_STEPS) return this.settle(tx, userId, saved!);
      return { round: toDTO(saved!), balance: null, nextCommit: await this.seeds.nextCommit(userId, tx) };
    });
  }

  async cashOut(userId: string, game: LadderGame, roundId: string, input: { version: number }): Promise<LadderUpdateDTO> {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, userId, game, roundId, input.version);
      if (row.level === 0) throw new GameError(400, "NOTHING_TO_CASH_OUT", "Win at least one step first");
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
