import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth";
import { LAB_ENDPOINT_SLUGS, type LabService } from "../../lab/service";
import { requireUser } from "../session";

const slug = z.string().regex(/^[a-z0-9-]{1,48}$/);
const VIP_COOKIE = "snk_lab_vip";

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function labRoutes(
  app: FastifyInstance,
  opts: { auth: Auth; lab: LabService; secureCookies: boolean },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook("preHandler", requireUser(opts.auth));
  const { lab } = opts;

  r.get("/v1/lab/challenges", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return lab.list(request.user!);
  });

  r.get(
    "/v1/lab/challenges/:slug/files/:index",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        params: z.object({
          slug,
          index: z.coerce.number().int().min(0).max(19),
        }),
      },
    },
    async (request, reply) => {
      const f = await lab.file(
        request.user!,
        request.params.slug,
        request.params.index,
      );
      const safeName = f.name.replace(/[^A-Za-z0-9._-]/g, "_");
      return reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("content-disposition", `attachment; filename="${safeName}"`)
        .header("cache-control", "no-store")
        .send(f.content);
    },
  );

  r.post(
    "/v1/lab/challenges/:slug/submit",
    {
      // Brute-forcing a flag should be pointless; this keeps it that way.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ slug }),
        body: z.object({ flag: z.string().min(1).max(200) }),
      },
    },
    async (request) =>
      lab.submit(request.user!, request.params.slug, request.body.flag),
  );

  // ---------------------------------------------------------------- challenge endpoints
  // Deliberately "vulnerable" pages. They only ever reveal the caller's own flag.

  r.get("/v1/lab/c/status", async (request, reply) => {
    const flag = await lab.endpointFlag(
      request.user!,
      LAB_ENDPOINT_SLUGS.status,
    );
    return reply
      .header("cache-control", "no-store")
      .header("x-debug-token", flag)
      .send({
        status: "ok",
        service: "snakeland-status",
        uptime: Math.round(process.uptime()),
        debug: "enabled",
      });
  });

  r.get("/v1/lab/c/vip", async (request, reply) => {
    const flag = await lab.endpointFlag(request.user!, LAB_ENDPOINT_SLUGS.vip);
    reply.header("cache-control", "no-store");
    const raw = readCookie(request.headers.cookie, VIP_COOKIE);
    type Who = { name?: unknown; role?: unknown };
    let who: Who | null = null;
    if (raw && raw.length <= 512) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(raw, "base64url").toString("utf8"),
        );
        if (parsed && typeof parsed === "object") who = parsed as Who;
      } catch {
        who = null;
      }
    }
    if (!who) {
      const value = Buffer.from(
        JSON.stringify({ name: request.user!.name, role: "guest" }),
      ).toString("base64url");
      reply.header(
        "set-cookie",
        [
          `${VIP_COOKIE}=${value}`,
          "Path=/v1/lab/c",
          "Max-Age=86400",
          "SameSite=Strict",
          ...(opts.secureCookies ? ["Secure"] : []),
        ].join("; "),
      );
      return reply
        .status(403)
        .send({
          door: "closed",
          message:
            "VIP only. We've noted who you are. Come back when you're an admin.",
        });
    }
    if (who.role !== "admin") {
      return reply
        .status(403)
        .send({
          door: "closed",
          message: `Sorry, ${String(who.role).slice(0, 40)}s aren't allowed in.`,
        });
    }
    return { door: "open", message: "Welcome to the VIP room.", flag };
  });
}
