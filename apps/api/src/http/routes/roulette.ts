import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { ROULETTE_LIMITS, ROULETTE_WHEELS, type WheelId } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { RouletteService } from "../../games/roulette/service";
import type { RouletteHub } from "../../realtime/roulette-hub";
import type { TicketStore } from "../../realtime/tickets";
import { requireUser } from "../session";

const wheelId = z.enum(ROULETTE_WHEELS.map((w) => w.id) as [WheelId, ...WheelId[]]);

export async function rouletteRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; roulette: RouletteService; hub: RouletteHub; tickets: TicketStore; webOrigins: string[] },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Live feed. Browsers don't apply CORS to WebSockets, so check Origin here
  // (cross-site WebSocket hijacking). Authenticate with a single-use ticket
  // (proxy deployments) or, failing that, the session cookie (shared-domain deployments).
  r.get(
    "/v1/roulette/ws",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        if (!origin || !opts.webOrigins.includes(origin)) {
          return reply.status(403).send({ error: { code: "FORBIDDEN_ORIGIN", message: "Origin not allowed" } });
        }
        const ticket = (request.query as { ticket?: unknown }).ticket;
        if (typeof ticket === "string") {
          const userId = await opts.tickets.redeem(ticket);
          if (!userId) return reply.status(401).send({ error: { code: "INVALID_TICKET", message: "Ticket expired" } });
          request.user = { id: userId, name: "", email: "", isAnonymous: false };
          return;
        }
        const session = await opts.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
        if (!session) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } });
        request.user = { id: session.user.id, name: session.user.name, email: session.user.email, isAnonymous: false };
      },
    },
    (socket, request) => opts.hub.attach(socket, request.user!.id),
  );

  await app.register(async (scoped) => {
    const s = scoped.withTypeProvider<ZodTypeProvider>();
    s.addHook("preHandler", requireUser(opts.auth));

    s.post(
      "/v1/roulette/ws-ticket",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request) => ({ ticket: await opts.tickets.issue(request.user!.id) }),
    );

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
