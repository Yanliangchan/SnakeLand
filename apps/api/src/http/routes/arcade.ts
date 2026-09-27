import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CARRIER_MODES, INSTANT_BET_LIMITS, LADDER_GAMES } from "@snakeland/shared";
import type { Auth } from "../../auth";
import { EVENT_HEADER, type EventService } from "../../events/service";
import type { CarrierService } from "../../games/arcade/carrier";
import type { LadderService } from "../../games/arcade/ladder";
import { CLIENT_SEED_RE } from "../../games/fair-seeds";
import { requireUser } from "../session";

const bet = z.number().int().min(INSTANT_BET_LIMITS.min).max(INSTANT_BET_LIMITS.max);
const clientSeed = z.string().regex(CLIENT_SEED_RE);
const version = z.number().int().min(1);
const roundParams = z.object({ roundId: z.uuid() });

export async function arcadeRoutes(app: FastifyInstance, opts: { auth: Auth; carrier: CarrierService; ladder: LadderService; events: EventService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  // ------------------------------------------------------------ Carrier
  r.post("/v1/carrier/state", async (request) => ({ nextCommit: await opts.carrier.nextCommit(request.user!.id) }));
  r.post(
    "/v1/carrier/flights",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: { body: z.object({ bet, mode: z.enum(CARRIER_MODES), clientSeed }) },
    },
    async (request) => opts.carrier.fly(request.user!.id, request.body, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "carrier")),
  );

  // ------------------------------------------------------------ Tower, Crossing, Penalty, Hi-Lo
  for (const game of LADDER_GAMES) {
    r.post(`/v1/${game}/state`, async (request) =>
      opts.ladder.state(request.user!.id, game, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, game)),
    );
    r.post(
      `/v1/${game}/rounds`,
      { schema: { body: z.object({ bet, mode: z.string().max(20), clientSeed }) } },
      async (request) =>
        opts.ladder.start(request.user!.id, game, request.body, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, game)),
    );
    r.post(
      `/v1/${game}/rounds/:roundId/step`,
      {
        config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
        schema: {
          params: roundParams,
          body: z.object({
            version,
            door: z.number().int().min(0).max(8).optional(),
            choice: z.enum(["higher", "lower", "skip"]).optional(),
          }),
        },
      },
      async (request) => opts.ladder.step(request.user!.id, game, request.params.roundId, request.body),
    );
    r.post(
      `/v1/${game}/rounds/:roundId/cashout`,
      { schema: { params: roundParams, body: z.object({ version }) } },
      async (request) => opts.ladder.cashOut(request.user!.id, game, request.params.roundId, request.body),
    );
  }
}
