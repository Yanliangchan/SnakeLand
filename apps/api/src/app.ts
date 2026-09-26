import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
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
import { RouletteDealer } from "./games/roulette/dealer";
import { RouletteService } from "./games/roulette/service";
import { authBridge } from "./http/auth-bridge";
import { baccaratRoutes } from "./http/routes/baccarat";
import { blackjackRoutes } from "./http/routes/blackjack";
import { instantRoutes } from "./http/routes/instant";
import { rouletteRoutes } from "./http/routes/roulette";
import { MemoryBus, RedisBus } from "./realtime/bus";
import { AlwaysLeader, RedisLeadership } from "./realtime/leader";
import { RouletteHub } from "./realtime/roulette-hub";
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
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
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

  // text/plain is a CORS "simple" content type, so a cross-site form could send
  // it without a preflight. Only accept JSON bodies.
  app.removeContentTypeParser("text/plain");

  const wallet = new WalletService(db);
  const auth = createAuth({ db, env, wallet });
  const blackjack = new BlackjackService(db, wallet);
  const seeds = new FairSeedService(db);
  const mines = new MinesService(db, wallet, seeds);
  const plinko = new PlinkoService(db, wallet, seeds);
  const baccarat = new BaccaratService(db, wallet);

  // Live games: Redis pub/sub + leader lease in production; in-process without Redis (tests).
  const bus = redis ? new RedisBus(redis, "snk:roulette") : new MemoryBus();
  const leadership = redis ? new RedisLeadership(redis, "snk:roulette:leader") : new AlwaysLeader();
  const roulette = new RouletteService(db, wallet, bus);
  const dealer = new RouletteDealer(db, wallet, roulette, bus, leadership, app.log);
  const hub = new RouletteHub(bus, roulette);
  app.addHook("onClose", async () => {
    await dealer.stop();
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
    keyGenerator: (req) => req.ip,
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
  await app.register(rouletteRoutes, { auth, roulette, hub, webOrigins: env.WEB_ORIGINS });

  return { app, auth, wallet, blackjack, mines, plinko, baccarat, roulette, dealer };
}
