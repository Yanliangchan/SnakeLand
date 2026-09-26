import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth";
import type { PurgeService } from "../../maintenance/purge";
import type { ProgressService } from "../../progress/service";
import { requireUser } from "../session";

export async function progressRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; progress: ProgressService; purge: PurgeService },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  r.get(
    "/v1/leaderboard",
    { schema: { querystring: z.object({ kind: z.enum(["weekly", "alltime"]).default("weekly") }) } },
    async (request) => opts.progress.leaderboard(request.query.kind, request.user!.id),
  );

  r.get("/v1/wallet/claim-terms", async (request) =>
    opts.progress.claimTermsFor(request.user!.id, request.user!.isAnonymous),
  );

  r.get("/v1/profile", async (request) => opts.progress.profile(request.user!.id));

  r.get(
    "/v1/players/:id",
    { schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (request, reply) => {
      const card = await opts.progress.publicProfile(request.params.id);
      if (!card) return reply.status(404).send({ error: { code: "PLAYER_NOT_FOUND", message: "Player not found" } });
      return card;
    },
  );

  r.post(
    "/v1/wallet/daily-claim",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = request.user!;
      const result = await opts.progress.claimDaily(user.id, user.isAnonymous);
      return {
        balance: result.balance,
        nextDailyClaimAt: result.nextDailyClaimAt,
        transaction: result.transaction,
        amount: result.amount,
        reasons: result.reasons,
      };
    },
  );

  /** A guest leaving for good: delete the guest and everything it owns. */
  r.post(
    "/v1/account/leave-guest",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = request.user!;
      if (!user.isAnonymous) {
        return reply.status(409).send({ error: { code: "NOT_A_GUEST", message: "Only guest sessions can be closed" } });
      }
      await opts.purge.purgeGuest(user.id);
      return { ok: true };
    },
  );
}
