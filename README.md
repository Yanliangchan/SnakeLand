# snakeland

A casino-style web app with **virtual chips only**. There's no real money anywhere, and every outcome is provably fair.
It has eleven games in one lobby: Blackjack, Mines, Plinko, Baccarat, Roulette, Crash, Carrier, Tower, Crossing,
Penalty and Hi-Lo, plus **The Lab**, ~20 capture-the-flag puzzles (with tiered hints and a live SQL-injection
sandbox) that pay chips.

> Status: live at snakeland.yanliangchan.com. All eleven games, The Lab, live chat, push notifications,
> leaderboards and the admin console are running.

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
  `sum(amount) = balance`. The only exception is deleting a whole guest, which opts in per transaction
  (`SET LOCAL snk.purge = 'on'`).
- Writes can take an idempotency key, so a retried request never pays twice.
- New players start with 1,000 chips. The daily free claim is 1,000 chips on a rolling 24h cooldown, enforced
  under the same row lock (perks can raise both, see below).
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

Mines has a **3% house edge** and Plinko **1%**. Bets are 10–10,000, and multipliers stored as integer hundredths
(`150` = 1.50×), so a payout is always exactly `floor(stake × x100 / 100)`.

- **Mines**: the player picks the board (3×3 to 8×8) and the number of mines (1 to tiles − 1). After *k* safe
  picks on a board of *t* tiles the multiplier is `floor(97 × C(t, k) / C(t − mines, k))` hundredths (capped at
  1,000,000×), computed with BigInt so there's no float drift. The mine
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
  10,000 per player per spin.
- **Architecture**: bets go through REST, the same hardened path as every other game. The live WebSocket
  (`/v1/live/ws`, shared with Crash) is a read-only feed: each socket joins one room (`roulette:w1`…`w3`,
  `crash`) and gets its state, countdowns, player counts and its own settlements. One API instance holds a Redis
  lease (`snk:roulette:leader`) and runs the dealer. Round state lives in Postgres, so if the leader dies another
  instance takes over mid-round. Events fan out to every instance's sockets through Redis pub/sub.
- **Integrity**: bets take a shared lock on the round, and closing it needs an exclusive one. A bet racing the
  buzzer is either in the spin or rejected, never lost (tested with concurrent bets during the close). Payouts
  are credited in the same transaction that settles the round.
- **Fairness**: the round's `sha256(serverSeed)` is published when betting opens. The result is
  `floor(HMAC-SHA256(serverSeed, roundId) × 37)`, sent when bets close so the wheel can animate to it, and the
  seed is revealed with the result. The Fair panel re-checks both.
- **WebSocket security**: the Origin must be on the allow-list (preventing cross-site WebSocket hijacking), the
  session cookie is required, messages are capped at 2 KB and 30 per 10s and validated with Zod, there are at
  most 5 sockets per user, and a heartbeat drops dead connections.

## Crash (live)

- **Round**: 7s of betting, then the multiplier grows as `e^(0.00006·t)` (2× after ~11.6s, 10× after ~38s)
  until it crashes; 3.5s later the next round opens. One bet per player per round, 10–10,000 chips, cancellable
  until takeoff. Cash out by hand at the server's current multiplier, or set an auto cash-out (1.01×–10,000×).
  Bets can be queued for the next round.
- **Odds**: crash point = `0.99 / (1 − r)` floored to hundredths, from one fair float `r`. `P(crash ≥ m) = 0.99/m`,
  so every cash-out target returns 99% (a 1% edge). About 2% of rounds crash instantly at 1.00×. A test checks
  the distribution.
- **Fairness**: the round's seed hash is published when betting opens. The crash point and its time stay on the
  server until the crash, then the seed is revealed and the Fair panel recomputes the crash point.
- **Integrity**: bets and cash-outs lock the round row (shared), takeoff and the crash take it exclusively, and a
  cash-out is only accepted before the crash time. Auto cash-outs are paid at their exact multiplier. Every payout
  has an idempotency key.
- **The snake**: the graph is a snake slithering up the curve on a single canvas; cash-outs show as flags on its
  body, and at the crash it bites (turns red and shakes). It only animates while something is moving.

## Carrier, Tower, Crossing, Penalty and Hi-Lo

Instant single-player games with a 97% return, on the same per-round seed commit–reveal as Mines and Plinko
(the Fair panel re-checks each outcome).

- **Carrier**: pick a speed (Calm/Normal/Fast/Turbo = 4/6/8/10 boosts). Each boost is a cloud (nothing), +0.5×,
  +1×, +2×, ×2, or a rocket that halves the multiplier, starting from 1×. Then the plane lands on the carrier
  (pays the multiplier) or splashes down (pays nothing). The landing chance is 0.97 ÷ the expected multiplier
  for that speed (47% / 39% / 34% / 30%); a test walks every outcome to check the exact return stays at 97%.
- **Tower**: 8 floors; pick one door per floor (Easy 3 of 4 safe, Medium 2 of 3, Hard 1 of 2, Expert 1 of 3).
- **Crossing**: hop lane by lane (Easy 4% hit per lane over 24 lanes, Medium 8%/22, Hard 20%/18,
  Daredevil 40%/12).
- Tower and Crossing pay `floor(97 ÷ P(surviving every step so far))`, can be cashed out after any step, cash
  out automatically at the top, and resume after a refresh. The whole layout is fixed by the seeds at the start.
- **Penalty**: ten kicks; pick a spot and beat the keeper (Easy 5 spots, Medium 3, Hard 2; the keeper covers one).
  Pays like Tower. Where the keeper dived is shown for kicks already taken; later dives stay secret.
- **Hi-Lo**: guess whether the next card is higher-or-same or lower-or-same, or skip it. Each correct guess
  multiplies by 13 ÷ (winning ranks), with 97% applied once: `floor(97 × Π 13/k)`, capped at 10,000×. A guess
  that can't raise the multiplier (higher on an ace) is refused. Up to 52 cards per round.
- **Auto**: Tower, Crossing, Penalty and Hi-Lo can auto-play a number of rounds, cashing out after a set number
  of steps, with optional stop-on-profit and stop-on-loss.

## The Lab

`/lab` is a set of ~20 capture-the-flag puzzles across crypto, web, forensics, casino and misc, ranging from
easy to insane. Guests can browse; registered players download files and submit flags. Each challenge pays its
chip reward once per player (Easy 1,000, Medium 3,000, Hard 7,500, Insane 15,000) as a `lab_reward` ledger row.
Lab chips don't count towards leaderboard profit. Most challenges are built to be solved with free online tools
(CyberChef, dcode.fr, jwt.io, factordb / alpertron).

- Challenges use **per-player flags** derived from `HMAC(secret, user, challenge)`, so answers can't be shared;
  nothing about them is stored. Admin-made challenges can also use one static flag, stored only as a hash.
- **Tiered hints**: each challenge has up to three hints — a nudge, the method and which online tool, then a
  near-walkthrough. Opening one permanently cuts that challenge's reward for that player (default 10/20/30%,
  capped at 75%); the reduced amount is fixed at solve time. Solvers see every hint afterwards.
- **SQL-injection challenges** run against a throwaway in-memory SQLite database, seeded fresh per request and
  completely isolated from the app's Postgres — real injection behaviour, no risk to real data. There's an easy
  browser-only login bypass and a UNION-based read. Other technical challenges cover Vigenère, repeating-key XOR,
  RSA with Fermat-close primes, an AES-ECB byte-at-a-time oracle, JWT forging with a weak secret, an LCG break
  and a seeded-PRNG brute force.
- A test **solves every challenge** from only what a player can see (including the SQLi sandbox, JWT, ECB oracle
  and RSA), so each one is proven solvable, pays once, and rejects other players' flags.
- Flag submissions are limited to 10 a minute; the "vulnerable" endpoints only ever reveal the caller's own flag.
- `/admin/lab` creates, edits, publishes and removes challenges and their hints (solved ones can only be
  unpublished).

## Live chat

Roulette and Crash have room chat, delivered over the game's socket. The last 50 messages per room live in Redis
and expire after a day of silence (nothing is written to Postgres). Guests can read; registered players can post
(at most 5 messages per 15 seconds, one per 1.2 s). Links are removed, control and bidi characters are stripped,
and common abuse is masked. Admins can mute a player from their admin page.

## Push notifications

Players can turn on notifications per device in Settings: daily chips ready, and weekly title won or lost (at most
once every 3 hours). The maintenance job sends them. Subscriptions are only accepted for the browsers' own push
services, and dead ones are removed automatically. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` on the API (`npx web-push generate-vapid-keys`); without them the feature is off.

## Live games only run while someone is playing

- Each live game (the three roulette wheels, crash) has a room. Presence counts sockets per room across
  instances. A room nobody is in finishes its current round and then its loop stops completely: no timers, no
  Redis, no Postgres. Opening the game wakes it within a tick.
- The browser only opens the live socket on the Roulette and Crash pages, and drops it after a minute in a
  background tab, so a forgotten tab doesn't keep a game running.
- The hub's heartbeat and presence timers only run while at least one socket is connected.
- Every game is its own JavaScript chunk, loaded when you open it (with a short entry animation), so the lobby
  never downloads game code.
- Both services start with `node` directly (no pnpm wrapper) and a capped V8 heap.

## Leaderboards, perks and profiles

Profit counts only play (bets, payouts, refunds); claims, bonuses and admin adjustments don't. Running counters
on `wallets` (lifetime profit, this week's profit, wagered, biggest win) are updated inside the same wallet
transaction, so rankings never scan the ledger. Only registered, non-suspended players rank.

- **Weekly board** (weeks start Monday 00:00 UTC) gives titles: #1 Snake King, #2 Black Mamba, #3 Viper. The
  registered player with the biggest loss of the week is titled Safety Stores.
- **All-time board** gives name colours and daily-claim perks: #1 gold name, +20% daily chips and a 12h cooldown;
  #2 silver name, +10%; #3 bronze name, +5%. The top 10 are Hall of Fame.
- `/profile` shows balance, weekly/all-time profit and rank, wagered, biggest win, rounds, favourite game,
  the current weekly title and the next claim's amount.

## Data retention

A background job runs every 10 minutes on one instance (Redis lease):

- **Guests** are deleted with everything they own when they sign out or leave, right after their chips move
  into a new account, or after 2 hours with no activity (no bet, claim or session refresh). A browser can't
  reliably report that a tab closed for good, so inactivity is the signal for guests who just leave. Registered accounts are never deleted.
- **Finished game rows** (rounds, shoes, closed tables, drops, settled roulette and crash bets) are deleted after
  7 days.
  Money records (the ledger) stay, so balances always reconcile.
- Expired sessions/verifications, rate-limit rows older than a day, and admin audit rows older than 90 days.

Resource use: the Postgres pool is 5 connections that close after 10 idle seconds, per-request logging is off in
production, and the push library and chat panel only load when first needed (see also "Live
games only run while someone is playing").

## Player experience

- **Help and tour**: the first visit to each game shows a three-step tour; `?` (or the help button) opens how to
  play plus every keyboard shortcut.
- **Session stats**: each game shows this tab's rounds, wagered, net and best multiplier.
- **Mines**: after a bust you see what cashing out one pick earlier would have paid, and can replay the round.
- **Settings**: sound (with volume), haptics (vibration on supported phones), motion (system / reduced / full),
  fast mode and notifications. Sounds are synthesized in the browser, so there are no audio files to download.
- **Game switcher**: tap a game's title (or press `G`) to jump to any other game.
- **Profiles**: tap any leaderboard name for that player's public card (no balance or email).
- **Installable**: a web app manifest and icons, so "Add to Home Screen" opens it full screen.
- Offline banner, retry cards for failed loads, and an error page that never shows a blank screen.

## Admin console

`/admin` is protected by a password stored only as an scrypt hash in `ADMIN_PASSWORD_HASH` (API service). Unset
disables the console (404). Sessions are random tokens kept hashed in Redis for 4 hours, in an `HttpOnly`,
`SameSite=Strict` cookie scoped to `/v1/admin`. Logins are rate-limited and lock for 15 minutes after 5 failures
from one IP (or 30 overall). Every action lands in `admin_audit`.

Admins can search players, view full profiles and recent transactions, add/remove/set chips (as `admin_adjust`
ledger rows), reset the daily claim, rename, suspend (signs out everywhere and blocks sign-in), sign a player out
everywhere, and permanently delete a player (typed-name confirmation; the audit log keeps who it was).

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
| Start command | `node --max-old-space-size=192 apps/api/dist/server.js` | `node --max-old-space-size=256 apps/web/node_modules/next/dist/bin/next start apps/web` |
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
ADMIN_PASSWORD_HASH=<output of pnpm --filter @snakeland/api admin:hash>   # enables /admin
VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>   # enables push notifications
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:<you>
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
