import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CHAT_MAX_LENGTH, LIVE_ROOMS } from "@snakeland/shared";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../../auth";
import type { ChatService } from "../../chat/service";
import type { LiveHub } from "../../realtime/live-hub";
import type { TicketStore } from "../../realtime/tickets";
import { requireUser } from "../session";

/** The one WebSocket for live games (roulette wheels and crash). */
export async function liveRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; hub: LiveHub; tickets: TicketStore; webOrigins: string[]; chat: ChatService },
) {
  // Browsers don't apply CORS to WebSockets, so check Origin here
  // (cross-site WebSocket hijacking). Authenticate with a single-use ticket
  // (proxy deployments) or, failing that, the session cookie (shared-domain deployments).
  app.get(
    "/v1/live/ws",
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
    scoped.addHook("preHandler", requireUser(opts.auth));
    scoped.post(
      "/v1/live/ws-ticket",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request) => ({ ticket: await opts.tickets.issue(request.user!.id) }),
    );

    // Chat rides the room's socket for delivery; history and posting are plain HTTP.
    const r = scoped.withTypeProvider<ZodTypeProvider>();
    const room = z.object({ room: z.enum(LIVE_ROOMS) });
    r.get("/v1/live/chat/:room", { schema: { params: room } }, async (request, reply) => {
      reply.header("cache-control", "no-store");
      return opts.chat.history(request.user!, request.params.room);
    });
    r.post(
      "/v1/live/chat/:room",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: { params: room, body: z.object({ text: z.string().min(1).max(CHAT_MAX_LENGTH * 2) }) },
      },
      async (request) => ({ message: await opts.chat.post(request.user!, request.params.room, request.body.text) }),
    );
  });
}
