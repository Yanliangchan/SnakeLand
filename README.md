# snakeland

A casino-style web app with **virtual chips only**. There's no real money anywhere, and every outcome is provably fair.
It has six games in one lobby: Blackjack, Mines, Plinko, Baccarat, Roulette and Crash.

> Status: **step 1 of 5**. Auth, wallet, lobby shell and the design-system component library are built.
> The games land in later steps.

## Stack

| Layer    | Choice                                                          |
| -------- | --------------------------------------------------------------- |
| Web      | Next.js 16 (App Router) · TypeScript · Tailwind v4 · Framer Motion |
| API      | Fastify 5 · Zod · Better Auth (email + password, guest mode)    |
| Data     | Postgres (Drizzle ORM + SQL migrations) · Redis (rate limits; live rounds later) |
| Hosting  | Railway: two services (`apps/web`, `apps/api`) on `app.` / `api.` subdomains |

```
apps/
  api/        Fastify API: auth, WalletService, routes, migrations
  web/        Next.js app: lobby, auth, wallet, settings, GameShell
packages/
  shared/     Types, game catalogue, chip constants, provably-fair helpers
```

## Local development

Requirements: Node 22+, pnpm 10, Postgres 16, Redis 7 (`docker compose up -d` starts both).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # then set BETTER_AUTH_SECRET: openssl rand -base64 48
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate
pnpm dev                                      # web on :3000, api on :4000
```

`/showcase` (dev only) shows every design-system component and motion spec in isolation.

### Checks

```bash
pnpm typecheck && pnpm lint && pnpm test      # API tests need Postgres (DB: snakeland_test)
```

## Money model

- Balances are **integer chips**, stored as `bigint` with a `CHECK (balance >= 0)`.
- `WalletService` (`apps/api/src/wallet`) is the **only** code that changes a balance. A lint rule blocks every
  other module from importing the `wallets`/`transactions` tables.
- Every change runs in one DB transaction. It locks the wallet row (`SELECT … FOR UPDATE`) and appends exactly one
  row to `transactions` (`user_id, game, table_id, round_id, amount, type, balance_after`).
- The ledger is **append-only**: a Postgres trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. For every user,
  `sum(amount) = balance`.
- Writes can take an idempotency key, so a retried request never pays twice.
- Daily free claim: 5,000 chips on a rolling 24h cooldown, enforced under the same row lock.
- Guest → account: a guest's chips (and claim cooldown) carry over **only into a brand-new account**. Signing a
  guest into an existing account doesn't merge anything, so guest sessions can't be farmed for chips.

## Security

- **Auth**: Better Auth handles password hashing (scrypt) and sessions. The session cookie is `HttpOnly`,
  `SameSite=Lax`, `Secure` in production, and scoped to the parent domain so `app.` and `api.` share it.
  Passwords must be 10–128 characters, and display names are length-checked with invisible/control characters
  stripped. Sign-in errors are generic, so they don't reveal which emails exist.
- **CSRF**: every state-changing request must carry an allow-listed `Origin`. Bodies must be JSON only
  (`text/plain` is rejected). Together with `SameSite=Lax` cookies this also blocks login CSRF.
- **CORS**: exact origin allow-list with credentials, and only `GET`/`POST`.
- **Rate limits**: a global per-IP limit backed by Redis, plus tighter limits on sign-in (5/min), sign-up (5/h),
  guest creation (10/h) and daily claims. The client IP comes from Fastify's `trustProxy` set to an exact hop
  count, never from a header the client controls.
- **Headers**: Helmet on the API (`default-src 'none'`, no framing, HSTS in production). The web app sends a
  per-request nonce-based CSP (`script-src 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`,
  `connect-src` limited to the API), plus `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`
  and COOP.
- **Input**: request schemas are validated with Zod, and body size is capped at 16 KB. The error handler never
  leaks internals, and logs redact cookies and auth headers.
- **Config**: environment variables are validated at boot. Production refuses to start with a non-HTTPS
  `API_URL`/`WEB_ORIGINS` or a secret shorter than 32 characters.
- **RNG** (used from step 2): outcomes are generated server-side only, with a commit-reveal of
  `sha256(serverSeed)`, and outcome floats come from `HMAC-SHA256(serverSeed, clientSeed:nonce:round)`.
  Players can verify results in the browser with `packages/shared/src/fair.ts`.

## Deploying to Railway

1. Create a project with **Postgres** and **Redis** plugins.
2. Add two services from this repo, and set each one's config file to `apps/api/railway.json` or
   `apps/web/railway.json`. The API runs its migrations as a pre-deploy step.
3. API variables: `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`,
   `API_URL=https://api.<domain>`, `WEB_ORIGINS=https://app.<domain>`, `COOKIE_DOMAIN=<domain>`,
   `TRUST_PROXY_HOPS=1`.
4. Web variables: `NEXT_PUBLIC_API_URL=https://api.<domain>` (needed at build time).
5. Attach custom domains `app.<domain>` and `api.<domain>`. Both must be on the same parent domain so the session
   cookie is first-party.
