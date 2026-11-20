import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { POKER_TABLES, type PokerTableId } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { PokerService } from "../../games/poker/service";
import { requireUser } from "../session";

const tableId = z.enum(POKER_TABLES.map((t) => t.id) as [PokerTableId, ...PokerTableId[]]);

export async function pokerRoutes(app: FastifyInstance, opts: { auth: Auth; poker: PokerService }) {
  await app.register(async (scoped) => {
    const s = scoped.withTypeProvider<ZodTypeProvider>();
    s.addHook("preHandler", requireUser(opts.auth));

    s.get("/v1/poker/lobby", async (request, reply) => {
      reply.header("cache-control", "no-store");
      return opts.poker.lobby(request.user!.id);
    });

    s.post("/v1/poker/view", { schema: { body: z.object({ tableId }) } }, async (request) =>
      opts.poker.view(request.body.tableId, request.user!.id),
    );

    s.post(
      "/v1/poker/sit",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: { body: z.object({ tableId, buyIn: z.number().int().positive().max(1_000_000_000) }) },
      },
      async (request) => opts.poker.sit({ id: request.user!.id, name: request.user!.name }, request.body.tableId, request.body.buyIn),
    );

    s.post("/v1/poker/leave", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) =>
      opts.poker.leave(request.user!.id),
    );

    s.post(
      "/v1/poker/act",
      {
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
        schema: {
          body: z.object({
            tableId,
            action: z.enum(["fold", "check", "call", "bet", "raise", "allin"]),
            to: z.number().int().positive().max(1_000_000_000_000).optional(),
          }),
        },
      },
      async (request) =>
        opts.poker.act(request.user!.id, request.body.tableId, { kind: request.body.action, to: request.body.to }),
    );
  });
}
