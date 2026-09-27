import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ADMIN_BALANCE_MODES, LAB_CATEGORIES, LAB_DIFFICULTIES, LAB_FLAG_MODES, LAB_MAX_REWARD, MAX_BALANCE } from "@snakeland/shared";
import {
  ADMIN_MAX_FAILS_PER_IP,
  ADMIN_MAX_FAILS_TOTAL,
  ADMIN_SESSION_TTL_S,
  verifyAdminPassword,
  type AdminStore,
} from "../../admin/auth";
import type { AdminService } from "../../admin/service";
import type { LabService } from "../../lab/service";
import type { PurgeService } from "../../maintenance/purge";
import type { WalletService } from "../../wallet/wallet-service";

const COOKIE = "snk_admin";
const COOKIE_PATH = "/v1/admin";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const idParams = z.object({ id: z.string().min(1).max(64) });

function readToken(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) {
      const value = v.join("=");
      return TOKEN_RE.test(value) ? value : null;
    }
  }
  return null;
}

export async function adminRoutes(
  app: FastifyInstance,
  opts: {
    passwordHash: string | undefined;
    secureCookies: boolean;
    store: AdminStore;
    admin: AdminService;
    wallet: WalletService;
    purge: PurgeService;
    lab: LabService;
  },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { admin, store } = opts;

  const cookie = (value: string, maxAge: number) =>
    [
      `${COOKIE}=${value}`,
      `Path=${COOKIE_PATH}`,
      `Max-Age=${maxAge}`,
      "HttpOnly",
      "SameSite=Strict",
      ...(opts.secureCookies ? ["Secure"] : []),
    ].join("; ");

  const disabled = (reply: FastifyReply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });

  // Everything except login needs a live admin session.
  r.addHook("preHandler", async (request, reply) => {
    if (!opts.passwordHash) return disabled(reply);
    if (request.routeOptions.url === "/v1/admin/login") return;
    const token = readToken(request);
    if (!token || !(await store.hasSession(token))) {
      return reply.status(401).send({ error: { code: "ADMIN_UNAUTHENTICATED", message: "Admin sign-in required" } });
    }
  });

  r.post(
    "/v1/admin/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: z.object({ password: z.string().min(1).max(200) }) },
    },
    async (request, reply) => {
      const ip = request.clientIp || request.ip;
      const fails = await store.failures(ip);
      if (fails.ip >= ADMIN_MAX_FAILS_PER_IP || fails.total >= ADMIN_MAX_FAILS_TOTAL) {
        return reply
          .status(429)
          .send({ error: { code: "ADMIN_LOCKED", message: "Too many attempts. Try again in 15 minutes." } });
      }
      const ok = await verifyAdminPassword(request.body.password, opts.passwordHash!);
      if (!ok) {
        await store.recordFailure(ip);
        await admin.audit("login_failed", null, null, ip);
        return reply.status(401).send({ error: { code: "ADMIN_BAD_PASSWORD", message: "Wrong password" } });
      }
      await store.clearFailures(ip);
      const token = await store.createSession();
      await admin.audit("login", null, null, ip);
      reply.header("set-cookie", cookie(token, ADMIN_SESSION_TTL_S));
      return { ok: true };
    },
  );

  r.post("/v1/admin/logout", async (request, reply) => {
    const token = readToken(request);
    if (token) await store.endSession(token);
    reply.header("set-cookie", cookie("", 0));
    return { ok: true };
  });

  r.get("/v1/admin/session", async () => ({ ok: true }));

  r.get("/v1/admin/stats", async () => admin.stats());

  r.get(
    "/v1/admin/players",
    {
      schema: {
        querystring: z.object({
          q: z.string().max(100).optional(),
          filter: z.enum(["all", "players", "guests", "suspended"]).default("all"),
          cursor: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) => admin.list(request.query),
  );

  r.get("/v1/admin/players/:id", { schema: { params: idParams } }, async (request) =>
    admin.detail(request.params.id),
  );

  r.post(
    "/v1/admin/players/:id/balance",
    {
      schema: {
        params: idParams,
        body: z.object({
          mode: z.enum(ADMIN_BALANCE_MODES),
          amount: z.number().int().min(-MAX_BALANCE).max(MAX_BALANCE),
          note: z.string().max(200).optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { mode, amount, note } = request.body;
      await admin.detail(id); // 404 for unknown players before touching money
      const result = await opts.wallet.adminAdjust(id, { mode, amount }, { by: "admin", mode, note: note ?? null });
      await admin.audit("balance", id, { mode, amount, delta: result.transaction.amount, note: note ?? null }, request.clientIp);
      return { balance: result.balance };
    },
  );

  r.post("/v1/admin/players/:id/reset-claim", { schema: { params: idParams } }, async (request) => {
    await admin.detail(request.params.id);
    await opts.wallet.resetDailyClaim(request.params.id);
    await admin.audit("reset_claim", request.params.id, null, request.clientIp);
    return { ok: true };
  });

  r.post(
    "/v1/admin/players/:id/rename",
    { schema: { params: idParams, body: z.object({ name: z.string().max(64) }) } },
    async (request) => {
      const name = await admin.rename(request.params.id, request.body.name);
      await admin.audit("rename", request.params.id, { name }, request.clientIp);
      return { name };
    },
  );

  r.post(
    "/v1/admin/players/:id/suspend",
    { schema: { params: idParams, body: z.object({ suspended: z.boolean() }) } },
    async (request) => {
      await admin.setSuspended(request.params.id, request.body.suspended);
      await admin.audit(request.body.suspended ? "suspend" : "unsuspend", request.params.id, null, request.clientIp);
      return { ok: true };
    },
  );

  r.post("/v1/admin/players/:id/sign-out", { schema: { params: idParams } }, async (request) => {
    const sessions = await admin.signOutEverywhere(request.params.id);
    await admin.audit("sign_out", request.params.id, { sessions }, request.clientIp);
    return { sessions };
  });

  // Permanent: the player, their wallet, ledger and game history all go.
  // The body must repeat the id, so a stray or replayed request can't delete anyone.
  r.post(
    "/v1/admin/players/:id/delete",
    { schema: { params: idParams, body: z.object({ confirmId: z.string().max(64) }) } },
    async (request, reply) => {
      const { id } = request.params;
      if (request.body.confirmId !== id) {
        return reply.status(400).send({ error: { code: "CONFIRM_MISMATCH", message: "Confirmation doesn't match this player" } });
      }
      const deleted = await opts.purge.purgePlayer(id);
      if (!deleted) return reply.status(404).send({ error: { code: "PLAYER_NOT_FOUND", message: "Player not found" } });
      admin.invalidate();
      // The audit row keeps who it was, since the user row is gone.
      await admin.audit(
        "delete_player",
        id,
        { name: deleted.name, email: deleted.isAnonymous ? null : deleted.email, guest: deleted.isAnonymous },
        request.clientIp,
      );
      return { ok: true };
    },
  );

  r.post(
    "/v1/admin/players/:id/chat-mute",
    { schema: { params: idParams, body: z.object({ muted: z.boolean() }) } },
    async (request) => {
      await admin.setChatMuted(request.params.id, request.body.muted);
      await admin.audit(request.body.muted ? "chat_mute" : "chat_unmute", request.params.id, null, request.clientIp);
      return { ok: true };
    },
  );

  // ------------------------------------------------------------------ The Lab
  const labInput = z.object({
    slug: z.string().regex(/^[a-z0-9-]{1,48}$/, "Lowercase letters, digits and dashes"),
    title: z.string().trim().min(1).max(80),
    category: z.enum(LAB_CATEGORIES),
    difficulty: z.enum(LAB_DIFFICULTIES),
    description: z.string().trim().min(1).max(4000),
    hints: z
      .array(z.object({ text: z.string().trim().min(1).max(600), penalty: z.number().int().min(0).max(75) }))
      .max(5),
    reward: z.number().int().min(1).max(LAB_MAX_REWARD),
    flagMode: z.enum(LAB_FLAG_MODES),
    flag: z.string().trim().max(200).optional(),
    files: z
      .array(z.object({ name: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/), content: z.string().max(100_000) }))
      .max(5),
    published: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
  });
  const labParams = z.object({ id: z.uuid() });

  r.get("/v1/admin/lab", async () => ({ challenges: await opts.lab.adminList() }));
  r.post("/v1/admin/lab", { schema: { body: labInput } }, async (request) => {
    const id = await opts.lab.create(request.body);
    await admin.audit("lab_create", null, { slug: request.body.slug }, request.clientIp);
    return { id };
  });
  r.post("/v1/admin/lab/:id", { schema: { params: labParams, body: labInput } }, async (request) => {
    await opts.lab.update(request.params.id, request.body);
    await admin.audit("lab_update", null, { slug: request.body.slug, flagChanged: Boolean(request.body.flag) }, request.clientIp);
    return { ok: true };
  });
  r.post("/v1/admin/lab/:id/delete", { schema: { params: labParams } }, async (request) => {
    await opts.lab.remove(request.params.id);
    await admin.audit("lab_delete", null, { id: request.params.id }, request.clientIp);
    return { ok: true };
  });
}
