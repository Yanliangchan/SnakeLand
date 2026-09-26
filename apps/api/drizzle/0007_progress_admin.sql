ALTER TYPE "public"."transaction_type" ADD VALUE 'admin_adjust';--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_perks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"top5_streak" integer DEFAULT 0 NOT NULL,
	"last_top5_day" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "next_daily_claim_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "lifetime_profit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "week_key" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "week_profit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "prev_week_key" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "prev_week_profit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "total_wagered" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "biggest_win" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_perks" ADD CONSTRAINT "player_perks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallets_week_profit_idx" ON "wallets" USING btree ("week_key","week_profit" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wallets_lifetime_profit_idx" ON "wallets" USING btree ("lifetime_profit" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign" CHECK (("transactions"."type" = 'bet' AND "transactions"."amount" < 0)
        OR ("transactions"."type" IN ('payout', 'refund', 'daily_claim', 'signup_bonus') AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text IN ('guest_merge', 'admin_adjust') AND "transactions"."amount" <> 0));