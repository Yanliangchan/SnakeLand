import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  INSTANT_BET_LIMITS,
  MINES_MAX,
  MINES_MIN,
  MINES_TILES,
  PLINKO_RISKS,
  PLINKO_ROWS_MAX,
  PLINKO_ROWS_MIN,
} from "@snakeland/shared";
import type { Auth } from "../../auth";
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
  opts: { auth: Auth; mines: MinesService; plinko: PlinkoService },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  // ------------------------------------------------------------ Mines
  r.post("/v1/mines/state", async (request) => opts.mines.state(request.user!.id));

  r.post(
    "/v1/mines/rounds",
    { schema: { body: z.object({ bet, mines: z.number().int().min(MINES_MIN).max(MINES_MAX), clientSeed }) } },
    async (request) => opts.mines.start(request.user!.id, request.body),
  );

  r.post(
    "/v1/mines/rounds/:roundId/reveal",
    {
      schema: {
        params: roundParams,
        body: z.object({ tile: z.number().int().min(0).max(MINES_TILES - 1), version }),
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
    async (request) => opts.plinko.drop(request.user!.id, request.body),
  );
}
