import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { INSTANT_BET_LIMITS, RACE_CRASH_TARGET } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { EventService } from "../../events/service";
import { requireUser } from "../session";

const params = z.object({ id: z.uuid() });

export async function eventRoutes(app: FastifyInstance, opts: { auth: Auth; events: EventService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  r.get("/v1/events", async () => opts.events.list());

  // Polled for the live scoreboard.
  r.get(
    "/v1/events/:id",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { params } },
    async (request) => opts.events.detail(request.params.id, request.user!.id),
  );

  r.post(
    "/v1/events/:id/join",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { params } },
    async (request) => opts.events.join(request.user!, request.params.id),
  );

  r.post(
    "/v1/events/:id/crash",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        params,
        body: z.object({
          bet: z.number().int().min(INSTANT_BET_LIMITS.min).max(INSTANT_BET_LIMITS.max),
          targetX100: z.number().int().min(RACE_CRASH_TARGET.min).max(RACE_CRASH_TARGET.max),
        }),
      },
    },
    async (request) => opts.events.crashRace(request.user!.id, request.params.id, request.body),
  );
}
