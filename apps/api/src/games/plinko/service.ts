import {
  INSTANT_BET_LIMITS,
  PLINKO_RISKS,
  applyX100,
  isPlinkoRows,
  plinkoMultiplierX100,
  plinkoPath,
  type PlinkoDropResultDTO,
  type PlinkoRisk,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import type { EventService, PlayCtx } from "../../events/service";
import { plinkoDrops } from "../../db/schema";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE, type FairSeedService } from "../fair-seeds";

export class PlinkoService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly seeds: FairSeedService,
    private readonly events?: EventService,
  ) {}

  /** Bets and payouts go to the event stack in an event, otherwise the wallet. */
  private async funds(tx: Tx, eventId: string | null, input: { userId: string; amount: number; roundId: string; key: string }) {
    if (eventId) return this.events!.apply(tx, eventId, input);
    const type = input.amount < 0 ? "bet" : "payout";
    return this.wallet.apply({ userId: input.userId, amount: input.amount, type, game: "plinko", roundId: input.roundId, idempotencyKey: input.key }, tx);
  }

  nextCommit(userId: string) {
    return this.seeds.nextCommit(userId);
  }

  /** One drop is one atomic round: bet, outcome, payout and seed reveal together. */
  async drop(
    userId: string,
    input: { bet: number; rows: number; risk: PlinkoRisk; clientSeed: string },
    ctx: PlayCtx | null = null,
  ): Promise<PlinkoDropResultDTO> {
    const { min, max } = INSTANT_BET_LIMITS;
    if (!Number.isSafeInteger(input.bet) || input.bet < min || input.bet > max) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${min}–${max.toLocaleString()} chips`);
    }
    if (!isPlinkoRows(input.rows)) throw new GameError(400, "INVALID_ROWS", "Choose 8–16 rows");
    if (!PLINKO_RISKS.includes(input.risk)) throw new GameError(400, "INVALID_RISK", "Unknown risk level");
    if (!CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }

    return this.db.transaction(async (tx) => {
      const seed = await this.seeds.consume(tx, userId);
      const id = crypto.randomUUID();
      const eventId = ctx?.eventId ?? null;
      const debit = await this.funds(tx, eventId, { userId, amount: -input.bet, roundId: id, key: `${id}:bet` });

      const { path, bucket } = plinkoPath(seed.serverSeed, input.clientSeed, input.rows);
      const multiplierX100 = plinkoMultiplierX100(input.rows, input.risk, bucket);
      const payout = applyX100(input.bet, multiplierX100);
      let balance = debit.balance;
      if (payout > 0) {
        const credit = await this.funds(tx, eventId, { userId, amount: payout, roundId: id, key: `${id}:payout` });
        balance = credit.balance;
      }

      await tx.insert(plinkoDrops).values({
        id,
        userId,
        eventId,
        bet: input.bet,
        rows: input.rows,
        risk: input.risk,
        path,
        bucket,
        multiplierX100,
        payout,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.commit,
        clientSeed: input.clientSeed,
      });

      return {
        drop: {
          id,
          bet: input.bet,
          rows: input.rows,
          risk: input.risk,
          path,
          bucket,
          multiplierX100,
          payout,
          reveal: { commit: seed.commit, serverSeed: seed.serverSeed, clientSeed: input.clientSeed },
        },
        balance,
        nextCommit: seed.nextCommit,
      };
    });
  }
}
