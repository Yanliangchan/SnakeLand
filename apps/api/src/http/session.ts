import type { FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isAnonymous: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function requireUser(auth: Auth) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } });
    }
    const u = session.user as typeof session.user & { isAnonymous?: boolean | null };
    request.user = { id: u.id, name: u.name, email: u.email, isAnonymous: Boolean(u.isAnonymous) };
  };
}
