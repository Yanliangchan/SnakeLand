import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth";
import { ecbOracle } from "../../lab/aes";
import { signJwt, verifyJwt } from "../../lab/jwt";
import { LAB_ENDPOINT_SLUGS, type LabService } from "../../lab/service";
import { sqliLogin, sqliSearch } from "../../lab/sqli";
import { requireUser } from "../session";

const slug = z.string().regex(/^[a-z0-9-]{1,48}$/);
// SQLi inputs must allow quotes, spaces, dashes etc — that's the whole point.
const injectable = z.string().max(400);

export async function labRoutes(app: FastifyInstance, opts: { auth: Auth; lab: LabService; secureCookies: boolean }) {
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
      schema: { params: z.object({ slug, index: z.coerce.number().int().min(0).max(19) }) },
    },
    async (request, reply) => {
      const f = await lab.file(request.user!, request.params.slug, request.params.index);
      const safeName = f.name.replace(/[^A-Za-z0-9._-]/g, "_");
      return reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("content-disposition", `attachment; filename="${safeName}"`)
        .header("cache-control", "no-store")
        .send(f.content);
    },
  );

  // Opening a hint reduces this challenge's reward for this player.
  r.post(
    "/v1/lab/challenges/:slug/hints/:index",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { params: z.object({ slug, index: z.coerce.number().int().min(0).max(9) }) },
    },
    async (request) => lab.unlockHint(request.user!, request.params.slug, request.params.index),
  );

  r.post(
    "/v1/lab/challenges/:slug/submit",
    {
      // Brute-forcing a flag should be pointless; this keeps it that way.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { params: z.object({ slug }), body: z.object({ flag: z.string().min(1).max(200) }) },
    },
    async (request) => lab.submit(request.user!, request.params.slug, request.body.flag),
  );

  // ---------------------------------------------------------------- challenge endpoints
  // Deliberately "vulnerable" pages. Each only ever reveals the caller's own
  // flag, and the SQL runs on a throwaway in-memory database, never Postgres.

  r.get("/v1/lab/c/status", async (request, reply) => {
    const flag = await lab.endpointFlag(request.user!, LAB_ENDPOINT_SLUGS.leakyHeader);
    return reply
      .header("cache-control", "no-store")
      .header("x-debug-token", flag)
      .send({ status: "ok", service: "snakeland-status", uptime: Math.round(process.uptime()), debug: "enabled" });
  });

  // JWT "become an admin" challenge. The token is signed with a weak secret.
  r.get(
    "/v1/lab/c/lounge",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const { flag, jwtSecret } = await lab.endpointContext(request.user!, LAB_ENDPOINT_SLUGS.lounge);
      const auth = request.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
      if (!token) {
        const guest = signJwt({ role: "guest", sub: request.user!.id }, jwtSecret);
        return reply.status(401).send({
          door: "closed",
          message: "Members only. Here's your guest pass — but the lounge is for admins. Send it back as 'Authorization: Bearer <token>'.",
          token: guest,
        });
      }
      const payload = verifyJwt(token, jwtSecret);
      if (!payload) return reply.status(401).send({ door: "closed", message: "That token doesn't verify. Wrong signature?" });
      if (payload.role !== "admin") {
        return reply.status(403).send({ door: "closed", message: `Sorry, '${String(payload.role).slice(0, 40)}' can't enter. Admins only.` });
      }
      return { door: "open", message: "Welcome to the lounge.", flag };
    },
  );

  // SQL injection: login bypass (in-memory SQLite, isolated from Postgres).
  r.get(
    "/v1/lab/sql/login",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: { querystring: z.object({ username: injectable.default(""), password: injectable.default("") }) },
    },
    async (request, reply) => {
      const { flag } = await lab.endpointContext(request.user!, LAB_ENDPOINT_SLUGS.sqlLogin);
      const result = await sqliLogin(flag, request.query.username, request.query.password);
      reply.header("cache-control", "no-store");
      return result;
    },
  );

  // SQL injection: UNION-based read from another table.
  r.get(
    "/v1/lab/sql/search",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: { querystring: z.object({ q: injectable.default("") }) },
    },
    async (request, reply) => {
      const { flag } = await lab.endpointContext(request.user!, LAB_ENDPOINT_SLUGS.sqlSearch);
      const result = await sqliSearch(flag, request.query.q);
      reply.header("cache-control", "no-store");
      return result;
    },
  );

  // AES-ECB encryption oracle for the byte-at-a-time challenge.
  r.get(
    "/v1/lab/sql/ecb",
    {
      // The attack needs many requests; allow it, but only ever leak the caller's flag.
      config: { rateLimit: { max: 3000, timeWindow: "1 minute" } },
      schema: { querystring: z.object({ data: z.string().regex(/^[0-9a-fA-F]*$/).max(512).default("") }) },
    },
    async (request, reply) => {
      const { flag, aesKey } = await lab.endpointContext(request.user!, LAB_ENDPOINT_SLUGS.ecb);
      const data = Buffer.from(request.query.data, "hex");
      reply.header("cache-control", "no-store");
      return { hex: ecbOracle(flag, aesKey, data) };
    },
  );
}
