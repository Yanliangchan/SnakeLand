import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { REFERRAL_CODE_RE } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { EngagementService } from "../../engagement/service";
import type { WalletService } from "../../wallet/wallet-service";
import { requireUser } from "../session";

export async function engagementRoutes(app: FastifyInstance, opts: { auth: Auth; wallet: WalletService; engagement: EngagementService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  // Daily bonus wheel.
  r.get("/v1/spin/state", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return opts.wallet.spinState(request.user!.id);
  });
  r.post("/v1/spin", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) =>
    opts.wallet.spinBonus(request.user!.id),
  );

  // Referrals.
  r.get("/v1/referral", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return opts.engagement.referralState(request.user!.id);
  });
  r.post(
    "/v1/referral/redeem",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: z.object({ code: z.string().regex(REFERRAL_CODE_RE) }) },
    },
    async (request) => opts.engagement.redeemReferral(request.user!, request.body.code),
  );

  // The active announcement banner (or none).
  r.get("/v1/announcement", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return { announcement: await opts.engagement.active() };
  });
}
