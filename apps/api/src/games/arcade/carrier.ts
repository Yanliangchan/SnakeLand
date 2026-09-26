import {
  INSTANT_BET_LIMITS,
  applyX100,
  carrierFlight,
  isCarrierMode,
  type CarrierFlightResultDTO,
  type CarrierMode,
} from "@snakeland/shared";
import type { Db } from "../../db/client";
import { carrierFlights } from "../../db/schema";
import type { WalletService } from "../../wallet/wallet-service";
import { GameError } from "../errors";
import { CLIENT_SEED_RE, type FairSeedService } from "../fair-seeds";

/** Carrier: one flight is one atomic round (bet, outcome, payout and seed reveal together). */
export class CarrierService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    private readonly seeds: FairSeedService,
  ) {}

  nextCommit(userId: string) {
    return this.seeds.nextCommit(userId);
  }

  async fly(userId: string, input: { bet: number; mode: CarrierMode; clientSeed: string }): Promise<CarrierFlightResultDTO> {
    const { min, max } = INSTANT_BET_LIMITS;
    if (!Number.isSafeInteger(input.bet) || input.bet < min || input.bet > max) {
      throw new GameError(400, "BET_OUT_OF_RANGE", `Bets are ${min}–${max.toLocaleString()} chips`);
    }
    if (!isCarrierMode(input.mode)) throw new GameError(400, "INVALID_MODE", "Unknown speed");
    if (!CLIENT_SEED_RE.test(input.clientSeed)) {
      throw new GameError(400, "INVALID_CLIENT_SEED", "Client seed must be 1–64 letters, digits, _ or -");
    }

    return this.db.transaction(async (tx) => {
      const seed = await this.seeds.consume(tx, userId);
      const id = crypto.randomUUID();
      const debit = await this.wallet.apply(
        { userId, amount: -input.bet, type: "bet", game: "carrier", roundId: id, idempotencyKey: `${id}:bet` },
        tx,
      );
      const outcome = carrierFlight(seed.serverSeed, input.clientSeed, input.mode);
      const payout = applyX100(input.bet, outcome.multiplierX100);
      let balance = debit.balance;
      if (payout > 0) {
        const credit = await this.wallet.apply(
          { userId, amount: payout, type: "payout", game: "carrier", roundId: id, idempotencyKey: `${id}:payout` },
          tx,
        );
        balance = credit.balance;
      }
      await tx.insert(carrierFlights).values({
        id,
        userId,
        bet: input.bet,
        mode: input.mode,
        landed: outcome.landed,
        finalX100: outcome.finalX100,
        multiplierX100: outcome.multiplierX100,
        payout,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.commit,
        clientSeed: input.clientSeed,
      });
      return {
        flight: {
          id,
          bet: input.bet,
          mode: input.mode,
          ...outcome,
          payout,
          reveal: { commit: seed.commit, serverSeed: seed.serverSeed, clientSeed: input.clientSeed },
        },
        balance,
        nextCommit: seed.nextCommit,
      };
    });
  }
}
