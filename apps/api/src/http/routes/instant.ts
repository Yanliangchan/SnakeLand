import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  INSTANT_BET_LIMITS,
  PLINKO_RISKS,
  PLINKO_ROWS_MAX,
  PLINKO_ROWS_MIN,
} from "@snakeland/shared";
import type { Auth } from "../../auth";
import { EVENT_HEADER, type EventService } from "../../events/service";
import { CLIENT_SEED_RE } from "../../games/fair-seeds";
import type { MinesService } from "../../games/mines/service";
import type { PlinkoService } from "../../games/plinko/service";
import { requireUser } from "../session";

const bet = z.number().int().min(INSTANT_BET_LIMITS.min).max(INSTANT_BET_LIMITS.max);
const clientSeed = z.string().regex(CLIENT_SEED_RE);
const version = z.number().int().min(1);
const roundParams = z.object({ roundId: z.uuid() });

export async function instantRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; mines: MinesService; plinko: PlinkoService; events: EventService },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  // ------------------------------------------------------------ Mines
  r.post("/v1/mines/state", async (request) => opts.mines.state(request.user!.id, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "mines")));

  r.post(
    "/v1/mines/rounds",
    {
      schema: {
        body: z.object({
          bet,
          size: z.number().int().min(3).max(8).optional(),
          // The exact upper bound depends on the board; the service checks it.
          mines: z.number().int().min(1).max(63),
          clientSeed,
        }),
      },
    },
    async (request) => opts.mines.start(request.user!.id, request.body, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "mines")),
  );

  r.post(
    "/v1/mines/rounds/:roundId/reveal",
    {
      schema: {
        params: roundParams,
        body: z.object({ tile: z.number().int().min(0).max(63), version }),
      },
    },
    async (request) => opts.mines.reveal(request.user!.id, request.params.roundId, request.body),
  );

  r.post(
    "/v1/mines/rounds/:roundId/cashout",
    { schema: { params: roundParams, body: z.object({ version }) } },
    async (request) => opts.mines.cashOut(request.user!.id, request.params.roundId, request.body),
  );

  // ------------------------------------------------------------ Plinko
  r.post("/v1/plinko/state", async (request) => ({ nextCommit: await opts.plinko.nextCommit(request.user!.id) }));

  r.post(
    "/v1/plinko/drops",
    {
      // Auto-drop fires several requests a second.
      config: { rateLimit: { max: 480, timeWindow: "1 minute" } },
      schema: {
        body: z.object({
          bet,
          rows: z.number().int().min(PLINKO_ROWS_MIN).max(PLINKO_ROWS_MAX),
          risk: z.enum(PLINKO_RISKS),
          clientSeed,
        }),
      },
    },
    async (request) => opts.plinko.drop(request.user!.id, request.body, await opts.events.resolve(request.headers[EVENT_HEADER], request.user!.id, "plinko")),
  );
}
