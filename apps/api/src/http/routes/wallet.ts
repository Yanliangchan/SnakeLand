import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { MeDTO } from "@snakeland/shared";
import type { Auth } from "../../auth";
import type { WalletService } from "../../wallet/wallet-service";
import { requireUser } from "../session";

export async function walletRoutes(app: FastifyInstance, opts: { auth: Auth; wallet: WalletService }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  r.get("/v1/me", async (request): Promise<MeDTO> => {
    const user = request.user!;
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.isAnonymous ? null : user.email,
        isGuest: user.isAnonymous,
      },
      wallet: await opts.wallet.getWallet(user.id),
    };
  });

  r.get("/v1/wallet", async (request) => opts.wallet.getWallet(request.user!.id));

  // POST /v1/wallet/daily-claim lives in progress routes (perks change the amount).

  r.get(
    "/v1/wallet/transactions",
    {
      schema: {
        querystring: z.object({
          cursor: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      },
    },
    async (request) => opts.wallet.listTransactions(request.user!.id, request.query),
  );
}
