import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { accounts, rateLimits, sessions, users, verifications } from "./db/schema";
import type { Env } from "./env";
import type { WalletService } from "./wallet/wallet-service";

/** Header the Fastify bridge sets from the proxy-aware `request.ip`. */
export const CLIENT_IP_HEADER = "x-snakeland-client-ip";

// Control chars (Cc) and invisible format chars (Cf: zero-width, bidi overrides).
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;

export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== "string") throw new APIError("BAD_REQUEST", { message: "Name is required" });
  const name = raw.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 32) {
    throw new APIError("BAD_REQUEST", { message: "Name must be 1–32 characters" });
  }
  return name;
}

function guestName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  return `Guest ${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function createAuth({
  db,
  env,
  wallet,
  purgeGuest,
}: {
  db: Db;
  env: Env;
  wallet: WalletService;
  /** Deletes the guest once its chips have moved to the new account. */
  purgeGuest?: (guestUserId: string) => Promise<unknown>;
}) {
  const isProd = env.NODE_ENV === "production";

  return betterAuth({
    appName: "Snakeland",
    baseURL: env.API_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.WEB_ORIGINS,

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
    }),

    emailAndPassword: {
      enabled: true,
      // v1: no email verification. Passwords are hashed by Better Auth (scrypt).
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh expiry at most once a day
      freshAge: 60 * 60, // sensitive actions (password change) need a login within the hour
    },

    user: {
      // Users can't change their email in v1; keep the attack surface small.
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },

    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60 * 60, max: 5 },
        "/sign-in/anonymous": { window: 60 * 60, max: 10 },
        "/change-password": { window: 60, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: "snk",
      useSecureCookies: isProd,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
      },
      crossSubDomainCookies: env.COOKIE_DOMAIN ? { enabled: true, domain: env.COOKIE_DOMAIN } : undefined,
      ipAddress: {
        // Only trust the header our own bridge writes from Fastify's proxy-aware IP.
        ipAddressHeaders: [CLIENT_IP_HEADER],
      },
    },

    hooks: {
      // A guest that signs out can never come back (the cookie was its only key),
      // so delete it and everything it owns right away.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-out" || !purgeGuest) return;
        const session = await getSessionFromCtx(ctx).catch(() => null);
        const user = session?.user as { id: string; isAnonymous?: boolean | null } | undefined;
        if (user?.isAnonymous) await purgeGuest(user.id);
      }),
    },

    databaseHooks: {
      session: {
        create: {
          // Suspended players can't sign in (the admin console also deletes their live sessions).
          before: async (session) => {
            const [u] = await db
              .select({ suspendedAt: users.suspendedAt })
              .from(users)
              .where(eq(users.id, session.userId));
            if (u?.suspendedAt) throw new APIError("FORBIDDEN", { message: "This account is suspended" });
            return { data: session };
          },
        },
      },
      user: {
        create: {
          before: async (user) => ({ data: { ...user, name: sanitizeDisplayName(user.name) } }),
        },
        update: {
          before: async (user) =>
            user.name === undefined ? { data: user } : { data: { ...user, name: sanitizeDisplayName(user.name) } },
        },
      },
    },

    plugins: [
      anonymous({
        emailDomainName: "guest.snakeland.invalid",
        generateName: () => guestName(),
        // We delete the guest ourselves (with all its game rows) after the merge.
        disableDeleteAnonymousUser: true,
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          try {
            const { merged } = await wallet.mergeGuestWallet(anonymousUser.user.id, newUser.user.id);
            if (merged && purgeGuest) await purgeGuest(anonymousUser.user.id);
          } catch (error) {
            // Never block sign-up on the merge; the account simply starts fresh.
            ctx.context.logger.error("guest wallet merge failed", {
              guest: anonymousUser.user.id,
              user: newUser.user.id,
              error,
            });
          }
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
