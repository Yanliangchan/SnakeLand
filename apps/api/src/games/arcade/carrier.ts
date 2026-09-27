import {
  INSTANT_BET_LIMITS,
  applyX100,
  carrierFlight,
  isCarrierMode,
  type CarrierFlightResultDTO,
  type CarrierMode,
} from "@snakeland/shared";
import type { Db, Tx } from "../../db/client";
import type { EventService, PlayCtx } from "../../events/service";
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
    private readonly events?: EventService,
  ) {}

  /** Bets and payouts go to the event stack in an event, otherwise the wallet. */
  private async funds(tx: Tx, eventId: string | null, input: { userId: string; amount: number; roundId: string; key: string }) {
    if (eventId) return this.events!.apply(tx, eventId, input);
    const type = input.amount < 0 ? "bet" : "payout";
    return this.wallet.apply({ userId: input.userId, amount: input.amount, type, game: "carrier", roundId: input.roundId, idempotencyKey: input.key }, tx);
  }

  nextCommit(userId: string) {
    return this.seeds.nextCommit(userId);
  }

  async fly(
    userId: string,
    input: { bet: number; mode: CarrierMode; clientSeed: string },
    ctx: PlayCtx | null = null,
  ): Promise<CarrierFlightResultDTO> {
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
      const eventId = ctx?.eventId ?? null;
      const debit = await this.funds(tx, eventId, { userId, amount: -input.bet, roundId: id, key: `${id}:bet` });
      const outcome = carrierFlight(seed.serverSeed, input.clientSeed, input.mode);
      const payout = applyX100(input.bet, outcome.multiplierX100);
      let balance = debit.balance;
      if (payout > 0) {
        const credit = await this.funds(tx, eventId, { userId, amount: payout, roundId: id, key: `${id}:payout` });
        balance = credit.balance;
      }
      await tx.insert(carrierFlights).values({
        id,
        userId,
        eventId,
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
