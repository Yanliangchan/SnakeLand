import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { GAME_IDS, TRANSACTION_TYPES } from "@snakeland/shared";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Auth tables (shape required by Better Auth; property names must stay camelCase)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  /** Set by an admin; suspended players can't play or claim. */
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------
// Money. Only WalletService may import `wallets` / `transactions` (enforced by lint).
// ---------------------------------------------------------------------------

export const gameEnum = pgEnum("game_id", GAME_IDS);
export const transactionTypeEnum = pgEnum("transaction_type", TRANSACTION_TYPES);

export const wallets = pgTable(
  "wallets",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    balance: bigint("balance", { mode: "number" }).notNull(),
    lastDailyClaimAt: timestamp("last_daily_claim_at", { withTimezone: true }),
    /** When the next daily claim unlocks (perks can shorten the cooldown). */
    nextDailyClaimAt: timestamp("next_daily_claim_at", { withTimezone: true }),
    // Running play counters, maintained by WalletService so leaderboards are cheap reads.
    lifetimeProfit: bigint("lifetime_profit", { mode: "number" }).notNull().default(0),
    weekKey: integer("week_key").notNull().default(0),
    weekProfit: bigint("week_profit", { mode: "number" }).notNull().default(0),
    prevWeekKey: integer("prev_week_key").notNull().default(0),
    prevWeekProfit: bigint("prev_week_profit", { mode: "number" }).notNull().default(0),
    totalWagered: bigint("total_wagered", { mode: "number" }).notNull().default(0),
    biggestWin: bigint("biggest_win", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("wallets_balance_non_negative", sql`${t.balance} >= 0`),
    index("wallets_week_profit_idx").on(t.weekKey, t.weekProfit.desc()),
    index("wallets_lifetime_profit_idx").on(t.lifetimeProfit.desc()),
  ],
);

/**
 * Append-only ledger. Every balance change is exactly one row, and for every
 * user `sum(amount) = wallets.balance`. UPDATE/DELETE are blocked by a trigger
 * (see the custom migration).
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    game: gameEnum("game"),
    tableId: uuid("table_id"),
    roundId: uuid("round_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    type: transactionTypeEnum("type").notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    // Millisecond precision so pagination cursors round-trip through JS Date exactly.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_user_created_idx").on(t.userId, t.createdAt.desc(), t.id.desc()),
    index("transactions_round_idx").on(t.roundId),
    uniqueIndex("transactions_user_idempotency_uq").on(t.userId, t.idempotencyKey),
    check("transactions_balance_after_non_negative", sql`${t.balanceAfter} >= 0`),
    check(
      "transactions_amount_sign",
      sql`(${t.type} = 'bet' AND ${t.amount} < 0)
        OR (${t.type} IN ('payout', 'refund', 'daily_claim', 'signup_bonus') AND ${t.amount} > 0)
        OR (${t.type}::text IN ('guest_merge', 'admin_adjust') AND ${t.amount} <> 0)`,
    ),
    check(
      "transactions_game_required",
      sql`${t.type} NOT IN ('bet', 'payout', 'refund') OR (${t.game} IS NOT NULL AND ${t.roundId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Blackjack
// ---------------------------------------------------------------------------

export const blackjackTables = pgTable(
  "blackjack_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    // One open table per user.
    uniqueIndex("blackjack_tables_one_open_uq").on(t.userId).where(sql`${t.closedAt} IS NULL`),
  ],
);

/**
 * One shuffled shoe. `serverSeed` is secret until `revealedAt` is set; the
 * order is fully determined by (serverSeed, clientSeed) and never stored.
 */
export const blackjackShoes = pgTable(
  "blackjack_shoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => blackjackTables.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decks: integer("decks").notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed"),
    position: integer("position").notNull().default(0),
    cutPosition: integer("cut_position").notNull(),
    createdAt: createdAt(),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
  },
  (t) => [
    index("blackjack_shoes_table_idx").on(t.tableId),
    // One live (unrevealed) shoe per table.
    uniqueIndex("blackjack_shoes_one_live_uq").on(t.tableId).where(sql`${t.revealedAt} IS NULL`),
    check("blackjack_shoes_position_range", sql`${t.position} >= 0 AND ${t.position} <= ${t.decks} * 52`),
  ],
);

export const roundStatusEnum = pgEnum("round_status", ["in_progress", "settled"]);

export const blackjackRounds = pgTable(
  "blackjack_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => blackjackTables.id, { onDelete: "restrict" }),
    shoeId: uuid("shoe_id")
      .notNull()
      .references(() => blackjackShoes.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: roundStatusEnum("status").notNull().default("in_progress"),
    /** Engine state (EngineState), including face-down cards: never sent to clients as-is. */
    state: jsonb("state").notNull(),
    version: integer("version").notNull().default(1),
    /** Shoe position of the first card of this round, so it can be replayed after the reveal. */
    shoeStart: integer("shoe_start").notNull(),
    totalBet: bigint("total_bet", { mode: "number" }).notNull(),
    totalPayout: bigint("total_payout", { mode: "number" }),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("blackjack_rounds_table_idx").on(t.tableId, t.createdAt.desc()),
    index("blackjack_rounds_user_idx").on(t.userId, t.createdAt.desc()),
    // At most one hand in play per table.
    uniqueIndex("blackjack_rounds_one_active_uq").on(t.tableId).where(sql`${t.status} = 'in_progress'`),
  ],
);

// ---------------------------------------------------------------------------
// Baccarat (same table/shoe model as blackjack; a round settles in one request)
// ---------------------------------------------------------------------------

export const baccaratTables = pgTable(
  "baccarat_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("baccarat_tables_one_open_uq").on(t.userId).where(sql`${t.closedAt} IS NULL`)],
);

export const baccaratShoes = pgTable(
  "baccarat_shoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => baccaratTables.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decks: integer("decks").notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed"),
    position: integer("position").notNull().default(0),
    cutPosition: integer("cut_position").notNull(),
    createdAt: createdAt(),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
  },
  (t) => [
    index("baccarat_shoes_table_idx").on(t.tableId),
    uniqueIndex("baccarat_shoes_one_live_uq").on(t.tableId).where(sql`${t.revealedAt} IS NULL`),
  ],
);

export const baccaratRounds = pgTable(
  "baccarat_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => baccaratTables.id, { onDelete: "restrict" }),
    shoeId: uuid("shoe_id")
      .notNull()
      .references(() => baccaratShoes.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** BaccaratHand from the engine. */
    hand: jsonb("hand").notNull(),
    bets: jsonb("bets").$type<Record<string, number>>().notNull(),
    shoeStart: integer("shoe_start").notNull(),
    totalBet: bigint("total_bet", { mode: "number" }).notNull(),
    totalPayout: bigint("total_payout", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("baccarat_rounds_table_idx").on(t.tableId, t.createdAt.desc()),
    index("baccarat_rounds_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Roulette (live, shared wheels)
// ---------------------------------------------------------------------------

export const roulettePhaseEnum = pgEnum("roulette_phase", ["betting", "spinning", "settled"]);

export const rouletteRounds = pgTable(
  "roulette_rounds",
  {
    id: uuid("id").primaryKey(),
    wheelId: text("wheel_id").notNull(),
    number: integer("number").notNull(),
    phase: roulettePhaseEnum("phase").notNull().default("betting"),
    /** Secret until the round is settled. */
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    result: integer("result"),
    opensAt: timestamp("opens_at", { withTimezone: true, precision: 3 }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true, precision: 3 }).notNull(),
    spinEndsAt: timestamp("spin_ends_at", { withTimezone: true, precision: 3 }),
    settledAt: timestamp("settled_at", { withTimezone: true, precision: 3 }),
  },
  (t) => [
    uniqueIndex("roulette_rounds_wheel_number_uq").on(t.wheelId, t.number),
    // One unsettled round per wheel.
    uniqueIndex("roulette_rounds_one_live_uq").on(t.wheelId).where(sql`${t.phase} <> 'settled'`),
    check("roulette_rounds_result_range", sql`${t.result} IS NULL OR ${t.result} BETWEEN 0 AND 36`),
  ],
);

export const rouletteBets = pgTable(
  "roulette_bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rouletteRounds.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Catalogue id, e.g. "split:17-20". */
    betId: text("bet_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** The player's table session (next table issues a new one). */
    tableId: uuid("table_id").notNull(),
    payout: bigint("payout", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("roulette_bets_round_idx").on(t.roundId),
    index("roulette_bets_user_idx").on(t.userId, t.createdAt.desc()),
    check("roulette_bets_amount_positive", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Instant games (Mines, Plinko): per-round commit–reveal
// ---------------------------------------------------------------------------

/**
 * The server seed a user's next instant round will use. Its hash is shown
 * before they bet; the seed itself stays secret until that round ends.
 */
export const fairSeeds = pgTable("fair_seeds", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "restrict" }),
  nextServerSeed: text("next_server_seed").notNull(),
  nextServerSeedHash: text("next_server_seed_hash").notNull(),
  updatedAt: updatedAt(),
});

export const minesStatusEnum = pgEnum("mines_status", ["playing", "cashed_out", "bust"]);

export const minesRounds = pgTable(
  "mines_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: minesStatusEnum("status").notNull().default("playing"),
    bet: bigint("bet", { mode: "number" }).notNull(),
    /** Board side length; tiles = size². */
    size: integer("size").notNull().default(5),
    mines: integer("mines").notNull(),
    /** Safe tiles picked, in order. */
    picks: jsonb("picks").$type<number[]>().notNull().default([]),
    bustTile: integer("bust_tile"),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    multiplierX100: integer("multiplier_x100").notNull().default(100),
    payout: bigint("payout", { mode: "number" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("mines_rounds_user_idx").on(t.userId, t.createdAt.desc()),
    uniqueIndex("mines_rounds_one_active_uq").on(t.userId).where(sql`${t.status} = 'playing'`),
    check("mines_rounds_size_range", sql`${t.size} BETWEEN 3 AND 8`),
    check("mines_rounds_mines_range", sql`${t.mines} BETWEEN 1 AND ${t.size} * ${t.size} - 1`),
  ],
);

export const plinkoRiskEnum = pgEnum("plinko_risk", ["low", "medium", "high"]);

export const plinkoDrops = pgTable(
  "plinko_drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bet: bigint("bet", { mode: "number" }).notNull(),
    rows: integer("rows").notNull(),
    risk: plinkoRiskEnum("risk").notNull(),
    path: jsonb("path").$type<(0 | 1)[]>().notNull(),
    bucket: integer("bucket").notNull(),
    multiplierX100: integer("multiplier_x100").notNull(),
    payout: bigint("payout", { mode: "number" }).notNull(),
    serverSeed: text("server_seed").notNull(),
    serverSeedHash: text("server_seed_hash").notNull(),
    clientSeed: text("client_seed").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("plinko_drops_user_idx").on(t.userId, t.createdAt.desc()),
    check("plinko_drops_rows_range", sql`${t.rows} BETWEEN 8 AND 16`),
  ],
);

// ---------------------------------------------------------------------------
// Progress, maintenance and admin
// ---------------------------------------------------------------------------

/** Consecutive days a player has been in the weekly top 5 (updated by the daily snapshot). */
export const playerPerks = pgTable("player_perks", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  top5Streak: integer("top5_streak").notNull().default(0),
  /** UTC day (YYYY-MM-DD) of the last snapshot that found them in the top 5. */
  lastTop5Day: text("last_top5_day"),
  updatedAt: updatedAt(),
});

/** Small key/value store for scheduled jobs (e.g. the last day the snapshot ran). */
export const maintenanceState = pgTable("maintenance_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

export const adminAudit = pgTable(
  "admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    /** Not a foreign key: the record outlives a deleted guest. */
    targetUserId: text("target_user_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt.desc())],
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  rateLimits,
  wallets,
  transactions,
  blackjackTables,
  blackjackShoes,
  blackjackRounds,
  fairSeeds,
  minesRounds,
  plinkoDrops,
  baccaratTables,
  baccaratShoes,
  baccaratRounds,
  rouletteRounds,
  rouletteBets,
  playerPerks,
  maintenanceState,
  adminAudit,
};
