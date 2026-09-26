# snakeland

A casino-style web app with **virtual chips only**. There's no real money anywhere, and every outcome is provably fair.
It has six games in one lobby: Blackjack, Mines, Plinko, Baccarat, Roulette and Crash.

> Status: **step 4 of 5**. Auth, wallet, lobby, the design system, **Blackjack**, **Mines**, **Plinko**, **Baccarat**
> and live **Roulette** are live. Crash comes next.

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

## Blackjack

- **Rules**: 6-deck shoe, reshuffled at 75% penetration. Blackjack pays 3:2 (rounded down to whole chips). The dealer
  stands on all 17s and peeks for blackjack under an ace or a 10. You can double on any first two cards, double
  after split, resplit up to 4 hands (split aces get one card each and can't be resplit), and take insurance
  (half the bet, pays 2:1). Bets are 10–5,000.
- **Engine**: `apps/api/src/games/blackjack/engine.ts` is pure and deterministic, with cards passed in through
  `draw()`. The service runs every action in one DB transaction that locks the round → shoe → wallet in that order.
  Hands live in Postgres, so a refresh (or a server restart) resumes the hand exactly where it was.
- **Double-submits**: every action carries the round `version`, and a stale version gets a 409. Each stake has its
  own idempotency key.
- **Tables**: one open table per user. "Next table" is blocked mid-hand. Otherwise it closes the table, reveals its
  shoe, and opens a fresh table + shoe, which resets recent results and streak. Wallet and history are unaffected.
- **Fairness**: each shoe commits to `sha256(serverSeed)` before any card is dealt. The browser sends a random client
  seed on the shoe's first deal. The shoe order is a Fisher–Yates shuffle driven by
  `HMAC-SHA256(serverSeed, "clientSeed:0:n")`. When the shoe is reshuffled or you leave the table, the server
  seed is revealed. The in-game "Fair" panel verifies the commit, and every hand can be replayed with
  `shuffleShoe(orderedShoe(6), serverSeed, clientSeed)[round.shoeStart + card.seq]`. The test suite does
  exactly this for a whole shoe.
- **Keyboard**: <kbd>H</kbd> hit · <kbd>S</kbd> stand · <kbd>D</kbd> double · <kbd>P</kbd> split ·
  <kbd>I</kbd>/<kbd>N</kbd> insurance · <kbd>Enter</kbd> deal.

## Mines and Plinko

Both games have a **1% house edge**, bets of 10–5,000, and multipliers stored as integer hundredths
(`150` = 1.50×), so a payout is always exactly `floor(stake × x100 / 100)`.

- **Mines**: a 5×5 grid with 1–24 mines. After *k* safe picks the multiplier is
  `floor(99 × C(25, k) / C(25 − mines, k))` hundredths, computed with BigInt so there's no float drift. The mine
  layout is the first *n* tiles of a fair Fisher–Yates shuffle. You can cash out any time after the first pick,
  and finding every safe tile cashes out automatically. A refresh resumes the round.
- **Plinko**: 8–16 rows × low/medium/high risk. There's one fair float per row (below 0.5 = left), so the landing
  bucket is simply the number of rights. It's decided by the seeds before anything moves, and the ball animates
  along that exact path. The 27 payout tables are original, and a test checks each one against the exact
  binomial odds (every table returns 98.7–99.0%, is symmetric, and rises toward the edges). High risk on
  16 rows tops out at 1,010×.
- **Fairness (per-round commit–reveal)**: each player always has one pre-committed server seed, and its hash is
  shown before they bet. Starting a round uses it together with the browser's client seed (random each round,
  or pinned in the Fair panel), then immediately commits the next one. The seed is revealed as soon as the round
  ends, and the Fair panel re-checks both the commit and the outcome (mine layout / ball path) in the browser.
- **Consistency**: rounds and money commit in one transaction. Mines actions carry a version (stale → 409), and
  every stake/payout has an idempotency key. Concurrent Plinko drops each lock and consume their own seed.
- **Keyboard**: Mines: <kbd>Enter</kbd> bet / cash out, <kbd>R</kbd> random tile. Plinko: <kbd>Space</kbd> /
  <kbd>Enter</kbd> drop.

## Baccarat

- **Table**: an 8-deck shoe on the same per-shoe commit–reveal as Blackjack, retired with 16 cards left. Punto banco
  tableau: naturals on 8/9; the player draws on 0–5; the banker follows the standard third-card table (a test
  checks every cell).
- **Payouts**: Player 1:1 · Banker 0.95:1 (5% commission, rounded down) · Tie 8:1 · Player/Banker bets returned on
  a tie · Player Pair / Banker Pair 11:1. Each bet is at least 10, and the total is at most 5,000 per hand.
- **Checks**: a 200,000-coup simulation reproduces the textbook 8-deck odds (Banker 45.86%, Player 44.62%,
  Tie 9.52%). A coup is dealt and settled in one transaction, and a full shoe replays exactly from its revealed
  seeds.

## Roulette (live)

- **Wheels**: three European single-zero wheels run continuously, staggered 8s apart. Each spin has 15s of
  betting, a ~7s spin, and 3s showing the result. Everyone watching a wheel sees the same spin. "Next table"
  moves you to the next wheel (not while your chips are riding) and starts a new table session id, which is
  recorded on your bets.
- **Bets**: straights, splits, streets, corners, six-lines, the zero splits/trios and first four, dozens, columns,
  and the even-money bets. That's a catalogue of every legal bet, and the server only accepts bets from it.
  Everything pays `stake × 36 / n` (every bet has the same 2.70% edge), with at least 10 per bet and at most
  5,000 per player per spin.
- **Architecture**: bets go through REST, the same hardened path as every other game. The WebSocket
  (`/v1/roulette/ws`) is a read-only feed of wheel state, countdowns, player counts, and your own settlement.
  One API instance holds a Redis lease (`snk:roulette:leader`) and runs the dealer. The dealer is a stateless
  tick that reads each wheel's round from Postgres, so if the leader dies another instance takes over mid-round.
  Events fan out to every instance's sockets through Redis pub/sub.
- **Integrity**: bets take a shared lock on the round, and closing it needs an exclusive one. A bet racing the
  buzzer is either in the spin or rejected, never lost (tested with concurrent bets during the close). Payouts
  are credited in the same transaction that settles the round.
- **Fairness**: the round's `sha256(serverSeed)` is published when betting opens. The result is
  `floor(HMAC-SHA256(serverSeed, roundId) × 37)`, sent when bets close so the wheel can animate to it, and the
  seed is revealed with the result. The Fair panel re-checks both.
- **WebSocket security**: the Origin must be on the allow-list (preventing cross-site WebSocket hijacking), the
  session cookie is required, messages are capped at 2 KB and 30 per 10s and validated with Zod, there are at
  most 5 sockets per user, and a heartbeat drops dead connections.

## Security

- **Auth**: Better Auth handles password hashing (scrypt) and sessions. The session cookie is `HttpOnly`,
  `SameSite=Lax`, `Secure` in production, and first-party on the web origin (the web app proxies API calls).
  Passwords must be 10–128 characters, and display names are length-checked with invisible/control characters
  stripped. Sign-in errors are generic, so they don't reveal which emails exist.
- **CSRF**: every state-changing request must carry an allow-listed `Origin`. Bodies must be JSON only
  (`text/plain` is rejected). Together with `SameSite=Lax` cookies this also blocks login CSRF.
- **CORS**: exact origin allow-list with credentials, and only `GET`/`POST` (only matters for direct API access;
  browsers normally reach the API same-origin through the web proxy).
- **Rate limits**: a global per-IP limit backed by Redis, plus tighter limits on sign-in (5/min), sign-up (5/h),
  guest creation (10/h) and daily claims. The client IP comes from the edge's header (`CLIENT_IP_HEADER`, Railway's
  `X-Real-IP`, forwarded unchanged by the web proxy) or an exact `X-Forwarded-For` hop count, never from a header
  the client controls.
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

The project runs as four services: **web**, **api**, **Postgres** and **Redis**. The browser only talks to the web
service. The web service forwards `/api/auth/*` and `/v1/*` to the API over Railway's private network
(`apps/web/src/lib/api-proxy.ts`), so the session cookie is first-party on the web domain and works on a plain
`*.up.railway.app` address. Live Roulette is the one exception: its WebSocket goes straight to the API's public
domain, authenticated with a single-use 30-second ticket minted through the proxy.

Service settings (set in the dashboard; Railway no longer reads `railway.json`). Both build from the repo root so
the pnpm workspace resolves:

| | API | Web |
| --- | --- | --- |
| Build command | `pnpm --filter @snakeland/api build` | `pnpm --filter @snakeland/web build` |
| Start command | `pnpm --filter @snakeland/api start` | `pnpm --filter @snakeland/web start` |
| Pre-deploy | `pnpm --filter @snakeland/api db:migrate:prod` | — |
| Healthcheck | `/healthz` | — |
| Watch paths | `apps/api/**`, `packages/shared/**`, `pnpm-lock.yaml` | `apps/web/**`, `packages/shared/**`, `pnpm-lock.yaml` |

**API variables**

```
NODE_ENV=production
PORT=8080
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
BETTER_AUTH_SECRET=<openssl rand -base64 48>
API_URL=https://<web domain>          # auth is served through the web origin
WEB_ORIGINS=https://<web domain>
CLIENT_IP_HEADER=x-real-ip            # Railway's edge sets it; used for rate limits
```

**Web variables** (`NEXT_PUBLIC_*` is read at build time)

```
PORT=8080
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080
NEXT_PUBLIC_WS_URL=wss://<api domain>
```

The API listens on `::` (IPv4 and IPv6, as required by the private network) and falls back to IPv4 where IPv6
isn't available. To use your own domain later, put both services on it and point the variables at the new
origins; nothing else changes.
