import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ROULETTE_LIMITS, ROULETTE_WHEELS, type WheelId } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { RouletteService } from "../../games/roulette/service";
import { requireUser } from "../session";

const wheelId = z.enum(ROULETTE_WHEELS.map((w) => w.id) as [WheelId, ...WheelId[]]);

export async function rouletteRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; roulette: RouletteService },
) {
  await app.register(async (scoped) => {
    const s = scoped.withTypeProvider<ZodTypeProvider>();
    s.addHook("preHandler", requireUser(opts.auth));

    s.post("/v1/roulette/state", { schema: { body: z.object({ wheelId }) } }, async (request) => {
      const wheel = await opts.roulette.wheelState(request.body.wheelId);
      const myBets = wheel.round ? await opts.roulette.myBets(request.user!.id, wheel.round.id) : null;
      return { wheel, myBets, serverNow: new Date().toISOString() };
    });

    s.post(
      "/v1/roulette/bets",
      {
        config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
        schema: {
          body: z.object({
            wheelId,
            roundId: z.uuid(),
            tableId: z.uuid(),
            bets: z
              .array(z.object({ betId: z.string().max(40), amount: z.number().int().min(ROULETTE_LIMITS.minBet).max(ROULETTE_LIMITS.maxRoundTotal) }))
              .min(1)
              .max(50),
          }),
        },
      },
      async (request) => opts.roulette.place(request.user!.id, request.body),
    );

    s.post(
      "/v1/roulette/bets/clear",
      { schema: { body: z.object({ wheelId, roundId: z.uuid() }) } },
      async (request) => opts.roulette.clear(request.user!.id, request.body),
    );
  });
}
