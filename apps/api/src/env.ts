import { z } from "zod";

const origin = z
  .string()
  .url()
  .transform((v) => new URL(v).origin);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /** 32+ random bytes, e.g. `openssl rand -base64 48`. Signs session cookies. */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Public origin of this API, e.g. https://api.example.com */
  API_URL: origin,
  /** Comma-separated list of browser origins allowed to call the API, e.g. https://app.example.com */
  WEB_ORIGINS: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(origin).min(1)),
  /** Parent domain shared by web + api (e.g. example.com). Unset for localhost. */
  COOKIE_DOMAIN: z.string().optional(),
  /** Number of trusted reverse-proxy hops in front of the API (Railway: 1). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
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
