import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { BLACKJACK_ACTIONS, BLACKJACK_RULES } from "@snakeland/shared";
import type { Auth } from "../../auth";
import { CLIENT_SEED_RE, type BlackjackService } from "../../games/blackjack/service";
import { requireUser } from "../session";

export async function blackjackRoutes(app: FastifyInstance, opts: { auth: Auth; blackjack: BlackjackService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));
  const bj = opts.blackjack;

  // POST (not GET): it may create the table, and must carry the CSRF origin check.
  r.post("/v1/blackjack/table", async (request) => bj.getTable(request.user!.id));

  r.post(
    "/v1/blackjack/table/next",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => bj.nextTable(request.user!.id),
  );

  r.post(
    "/v1/blackjack/rounds",
    {
      schema: {
        body: z.object({
          tableId: z.uuid(),
          bet: z.number().int().min(BLACKJACK_RULES.minBet).max(BLACKJACK_RULES.maxBet),
          clientSeed: z.string().regex(CLIENT_SEED_RE).optional(),
        }),
      },
    },
    async (request) => bj.startRound(request.user!.id, request.body),
  );

  r.post(
    "/v1/blackjack/rounds/:roundId/actions",
    {
      schema: {
        params: z.object({ roundId: z.uuid() }),
        body: z.object({ action: z.enum(BLACKJACK_ACTIONS), version: z.number().int().min(1) }),
      },
    },
    async (request) => bj.act(request.user!.id, request.params.roundId, request.body),
  );

  r.get(
    "/v1/blackjack/shoes/:shoeId",
    { schema: { params: z.object({ shoeId: z.uuid() }) } },
    async (request) => bj.getShoe(request.user!.id, request.params.shoeId),
  );
}
