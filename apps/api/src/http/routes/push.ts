import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth";
import type { PushService } from "../../push/service";
import { requireUser } from "../session";

const endpoint = z.url().max(1000);

export async function pushRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; push: PushService },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));

  r.get("/v1/push/config", async () => opts.push.config());
  r.post(
    "/v1/push/prefs",
    { schema: { body: z.object({ endpoint }) } },
    async (request) => ({
      prefs: await opts.push.prefs(request.user!.id, request.body.endpoint),
    }),
  );
  r.post(
    "/v1/push/subscribe",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: z.object({
          endpoint,
          keys: z.object({
            p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
            auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/),
          }),
          daily: z.boolean(),
          titles: z.boolean(),
        }),
      },
    },
    async (request) => {
      const b = request.body;
      await opts.push.subscribe(request.user!, {
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        daily: b.daily,
        titles: b.titles,
      });
      return { ok: true };
    },
  );
  r.post(
    "/v1/push/unsubscribe",
    { schema: { body: z.object({ endpoint }) } },
    async (request) => {
      await opts.push.unsubscribe(request.user!.id, request.body.endpoint);
      return { ok: true };
    },
  );
}
