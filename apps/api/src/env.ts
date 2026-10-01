import { z } from "zod";

const origin = z
  .string()
  .url()
  .transform((v) => new URL(v).origin);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // "::" listens on IPv6 and IPv4 (Railway private networking resolves over IPv6).
  HOST: z.string().default("::"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /** 32+ random bytes, e.g. `openssl rand -base64 48`. Signs session cookies. */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /**
   * Public origin where browsers reach the auth routes: the API's own origin, or
   * the web origin when the web app proxies /api and /v1 to the API.
   */
  API_URL: origin,
  /** Comma-separated list of browser origins allowed to call the API, e.g. https://app.example.com */
  WEB_ORIGINS: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(origin).min(1)),
  /** Parent domain shared by web + api (e.g. example.com). Unset for localhost. */
  COOKIE_DOMAIN: z.string().optional(),
  /**
   * Header set by the trusted edge with the client's IP (Railway: "x-real-ip").
   * When set it is the only source of the client IP; otherwise TRUST_PROXY_HOPS applies.
   */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  /** Number of trusted X-Forwarded-For hops in front of the API (ignored with CLIENT_IP_HEADER). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * scrypt hash of the /admin password (`pnpm --filter @snakeland/api admin:hash`).
   * Unset disables the admin console.
   */
  /** Web push (VAPID) keys: `npx web-push generate-vapid-keys`. Unset disables notifications. */
  VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{80,100}$/)
    .optional(),
  VAPID_PRIVATE_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{40,50}$/)
    .optional(),
  /** Contact for push services, e.g. mailto:you@example.com */
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)/)
    .optional(),
  /**
   * Optional second factor for /admin: a base32 TOTP secret (`admin:hash --totp`).
   * When set, admin sign-in also needs the current authenticator code.
   */
  ADMIN_TOTP_SECRET: z
    .string()
    .regex(/^[A-Z2-7]{32,64}$/, "ADMIN_TOTP_SECRET must be base32 (from admin:hash --totp)")
    .optional(),
  ADMIN_PASSWORD_HASH: z
    .string()
    .regex(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/, "ADMIN_PASSWORD_HASH must come from the admin:hash script")
    .optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (!env.API_URL.startsWith("https://")) throw new Error("API_URL must be https in production");
    if (env.WEB_ORIGINS.some((o) => !o.startsWith("https://"))) {
      throw new Error("WEB_ORIGINS must all be https in production");
    }
  }
  return env;
}
