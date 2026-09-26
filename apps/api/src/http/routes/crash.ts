import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CRASH_LIMITS } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { CrashService } from "../../games/crash/service";
import { requireUser } from "../session";

const round = z.object({ roundId: z.uuid() });

export async function crashRoutes(app: FastifyInstance, opts: { auth: Auth; crash: CrashService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  r.post("/v1/crash/state", async (request) => {
    const state = await opts.crash.state(request.user!.id);
    const myBet = state.round ? await opts.crash.myBet(request.user!.id, state.round.id) : null;
    return { state, myBet, serverNow: new Date().toISOString() };
  });

  r.post(
    "/v1/crash/bet",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        body: round.extend({
          amount: z.number().int().min(CRASH_LIMITS.minBet).max(CRASH_LIMITS.maxBet),
          autoCashoutX100: z.number().int().min(CRASH_LIMITS.minAutoX100).max(CRASH_LIMITS.maxAutoX100).nullish(),
        }),
      },
    },
    async (request) => opts.crash.bet(request.user!.id, request.body),
  );

  r.post("/v1/crash/cancel", { schema: { body: round } }, async (request) =>
    opts.crash.cancel(request.user!.id, request.body),
  );

  r.post(
    "/v1/crash/cashout",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { body: round } },
    async (request) => opts.crash.cashout(request.user!.id, request.body),
  );
}
