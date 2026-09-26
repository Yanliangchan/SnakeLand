import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { CLIENT_IP_HEADER, type Auth } from "../auth";

const HOP_BY_HOP = new Set(["content-length", "transfer-encoding", "connection", "set-cookie"]);

/**
 * Mounts Better Auth under /api/auth/*. Runs in its own encapsulated context
 * so the body reaches Better Auth unparsed (it does its own validation).
 */
export async function authBridge(app: FastifyInstance, opts: { auth: Auth; apiUrl: string }) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 16 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const headers = fromNodeHeaders(request.headers);
      // Never trust a client-supplied value; always overwrite with the proxy-aware IP.
      headers.set(CLIENT_IP_HEADER, request.ip);

      const response = await opts.auth.handler(
        new Request(new URL(request.url, opts.apiUrl), {
          method: request.method,
          headers,
          body: request.method === "GET" ? undefined : ((request.body as string | undefined) ?? undefined),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key)) reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      reply.header("cache-control", "no-store");

      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}
