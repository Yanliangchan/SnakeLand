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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("wallets_balance_non_negative", sql`${t.balance} >= 0`)],
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
        OR (${t.type} = 'guest_merge' AND ${t.amount} <> 0)`,
    ),
    check(
      "transactions_game_required",
      sql`${t.type} NOT IN ('bet', 'payout', 'refund') OR (${t.game} IS NOT NULL AND ${t.roundId} IS NOT NULL)`,
    ),
  ],
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  rateLimits,
  wallets,
  transactions,
};
