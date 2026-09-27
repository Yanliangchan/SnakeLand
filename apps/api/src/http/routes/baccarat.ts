import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { BACCARAT_RULES } from "@snakeland/shared";
import type { Auth } from "../../auth";
import { EVENT_HEADER, type EventService } from "../../events/service";
import type { BaccaratService } from "../../games/baccarat/service";
import { CLIENT_SEED_RE } from "../../games/fair-seeds";
import { requireUser } from "../session";

const stake = z.number().int().min(0).max(BACCARAT_RULES.maxTotal).optional();

export async function baccaratRoutes(app: FastifyInstance, opts: { auth: Auth; baccarat: BaccaratService; events: EventService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  r.post("/v1/baccarat/table", async (request) => opts.baccarat.getTable(request.user!.id, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "baccarat")));
  r.post(
    "/v1/baccarat/table/next",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => opts.baccarat.nextTable(request.user!.id, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "baccarat")),
  );
  r.post(
    "/v1/baccarat/rounds",
    {
      schema: {
        body: z.object({
          tableId: z.uuid(),
          bets: z.strictObject({ player: stake, banker: stake, tie: stake, playerPair: stake, bankerPair: stake }),
          clientSeed: z.string().regex(CLIENT_SEED_RE).optional(),
        }),
      },
    },
    async (request) => opts.baccarat.play(request.user!.id, request.body, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "baccarat")),
  );
}
