import Fastify, { LogController, type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { CRASH_ROOM, ROULETTE_WHEELS, rouletteRoom } from "@snakeland/shared";
import type { Redis } from "ioredis";
import { createAuth } from "./auth";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { GameError } from "./games/errors";
import { BaccaratService } from "./games/baccarat/service";
import { BlackjackService } from "./games/blackjack/service";
import { FairSeedService } from "./games/fair-seeds";
import { MinesService } from "./games/mines/service";
import { PlinkoService } from "./games/plinko/service";
import { CrashDealer } from "./games/crash/dealer";
import { CrashService } from "./games/crash/service";
import { RouletteDealer } from "./games/roulette/dealer";
import { RouletteService } from "./games/roulette/service";
import { authBridge } from "./http/auth-bridge";
import { baccaratRoutes } from "./http/routes/baccarat";
import { blackjackRoutes } from "./http/routes/blackjack";
import { instantRoutes } from "./http/routes/instant";
import { crashRoutes } from "./http/routes/crash";
import { liveRoutes } from "./http/routes/live";
import { rouletteRoutes } from "./http/routes/roulette";
import { adminRoutes } from "./http/routes/admin";
import { progressRoutes } from "./http/routes/progress";
import { MemoryAdminStore, RedisAdminStore } from "./admin/auth";
import { AdminService } from "./admin/service";
import { MaintenanceRunner } from "./maintenance/runner";
import { PurgeService } from "./maintenance/purge";
import { ProgressService } from "./progress/service";
import { MemoryBus, RedisBus } from "./realtime/bus";
import { AlwaysLeader, RedisLeadership } from "./realtime/leader";
import { MemoryPresence, RedisPresence } from "./realtime/presence";
import { LiveHub } from "./realtime/live-hub";
import { MemoryTicketStore, RedisTicketStore } from "./realtime/tickets";
import { walletRoutes } from "./http/routes/wallet";
import { WalletError } from "./wallet/errors";
import { WalletService } from "./wallet/wallet-service";

const WALLET_ERROR_STATUS: Record<WalletError["code"], number> = {
  INSUFFICIENT_FUNDS: 409,
  BALANCE_LIMIT: 409,
  INVALID_AMOUNT: 400,
  DAILY_CLAIM_NOT_READY: 409,
  WALLET_NOT_FOUND: 404,
  INVALID_CURSOR: 400,
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp({ env, db, redis }: { env: Env; db: Db; redis: Redis | null }) {
  const app = Fastify({
    // Per-request logs are noise at our scale; errors are still logged.
    logController: new LogController({ disableRequestLogging: env.NODE_ENV === "production" }),
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
            serializers: {
              // Never log query strings: the WebSocket ticket travels in one.
              req: (req: { method: string; url: string; id: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url.split("?")[0],
              }),
            },
          },
    // Trust exactly N proxy hops (Railway edge = 1) so request.ip is the real client.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 16 * 1024,
    // Don't let clients pick request ids that end up in our logs.
    genReqId: () => crypto.randomUUID(),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("user", null);
  app.decorateRequest("clientIp", "");
  const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;
  app.addHook("onRequest", async (request) => {
    const header = env.CLIENT_IP_HEADER ? request.headers[env.CLIENT_IP_HEADER] : undefined;
    const value = typeof header === "string" ? header.trim() : "";
    request.clientIp = IP_RE.test(value) ? value : request.ip;
  });

  // text/plain is a CORS "simple" content type, so a cross-site form could send
  // it without a preflight. Only accept JSON bodies.
  app.removeContentTypeParser("text/plain");

  const wallet = new WalletService(db);
  const purge = new PurgeService(db);
  const auth = createAuth({ db, env, wallet, purgeGuest: (id) => purge.purgeGuest(id) });
  const blackjack = new BlackjackService(db, wallet);
  const seeds = new FairSeedService(db);
  const mines = new MinesService(db, wallet, seeds);
  const plinko = new PlinkoService(db, wallet, seeds);
  const baccarat = new BaccaratService(db, wallet);

  // Live games: Redis pub/sub + leader lease in production; in-process without Redis (tests).
  // Each game loop sleeps until someone joins its room.
  const bus = redis ? new RedisBus(redis, "snk:live") : new MemoryBus();
  const lease = (key: string) => (redis ? new RedisLeadership(redis, key) : new AlwaysLeader());
  const presence = redis ? new RedisPresence(redis) : new MemoryPresence();
  const roulette = new RouletteService(db, wallet, bus);
  const dealer = new RouletteDealer(db, wallet, roulette, bus, lease("snk:roulette:leader"), presence, app.log);
  const crash = new CrashService(db, wallet, bus);
  const crashDealer = new CrashDealer(db, wallet, crash, bus, lease("snk:crash:leader"), presence, app.log);
  const hub = new LiveHub(bus, presence, async (room, userId) => {
    if (room === CRASH_ROOM) return { type: "crash-state", state: await crash.state(userId) };
    const wheel = ROULETTE_WHEELS.find((w) => rouletteRoom(w.id) === room)!;
    return { type: "state", wheel: await roulette.wheelState(wheel.id) };
  });
  const tickets = redis ? new RedisTicketStore(redis) : new MemoryTicketStore();

  const progress = new ProgressService(db, wallet);
  const maintenance = new MaintenanceRunner(
    purge,
    redis ? new RedisLeadership(redis, "snk:maint:leader", 60_000) : new AlwaysLeader(),
    app.log,
  );
  const admin = new AdminService(db, wallet, progress);
  const adminStore = redis ? new RedisAdminStore(redis) : new MemoryAdminStore();

  app.addHook("onClose", async () => {
    await maintenance.stop();
    await dealer.stop();
    await crashDealer.stop();
    await hub.close();
    await bus.close();
  });

  await app.register(helmet, {
    // JSON-only API: nothing should ever render or frame it.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: env.NODE_ENV === "production" ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
  });

  await app.register(cors, {
    origin: env.WEB_ORIGINS,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["content-type"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    ...(redis ? { redis, nameSpace: "snk:rl:" } : {}),
    keyGenerator: (req) => req.clientIp || req.ip,
  });

  // CSRF defence: every state-changing request (including /api/auth, where Better
  // Auth skips its own Origin check when no cookie is sent) must come from an
  // allow-listed browser origin. Combined with SameSite=Lax cookies and a
  // JSON-only body parser this also blocks login CSRF.
  app.addHook("onRequest", async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin || !env.WEB_ORIGINS.includes(origin)) {
      return reply.status(403).send({ error: { code: "FORBIDDEN_ORIGIN", message: "Request origin not allowed" } });
    }
  });

  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/v1/")) reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof WalletError) {
      return reply
        .status(WALLET_ERROR_STATUS[error.code])
        .send({ error: { code: error.code, message: error.message, ...error.details } });
    }
    if (error instanceof GameError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code ?? "BAD_REQUEST", message: error.message } });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found" } }),
  );

  app.get("/healthz", { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  await app.register(websocket, { options: { maxPayload: 2048 } });
  await app.register(authBridge, { auth, apiUrl: env.API_URL });
  await app.register(walletRoutes, { auth, wallet });
  await app.register(blackjackRoutes, { auth, blackjack });
  await app.register(instantRoutes, { auth, mines, plinko });
  await app.register(baccaratRoutes, { auth, baccarat });
  await app.register(liveRoutes, { auth, hub, tickets, webOrigins: env.WEB_ORIGINS });
  await app.register(rouletteRoutes, { auth, roulette });
  await app.register(crashRoutes, { auth, crash });
  await app.register(progressRoutes, { auth, progress, purge });
  await app.register(adminRoutes, {
    passwordHash: env.ADMIN_PASSWORD_HASH,
    secureCookies: env.NODE_ENV === "production",
    store: adminStore,
    admin,
    wallet,
    purge,
  });

  return { app, auth, wallet, blackjack, mines, plinko, baccarat, roulette, dealer, crash, crashDealer, progress, purge, maintenance, admin, presence };
}
