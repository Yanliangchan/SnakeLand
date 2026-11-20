ALTER TYPE "public"."game_id" ADD VALUE 'poker';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'table_buyin';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'table_cashout';--> statement-breakpoint
CREATE TABLE "poker_hands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"number" integer NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"board" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"rake" bigint DEFAULT 0 NOT NULL,
	"house_net" bigint DEFAULT 0 NOT NULL,
	"humans" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poker_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"table_id" text NOT NULL,
	"buy_in" bigint NOT NULL,
	"cash_out" bigint,
	"opened_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp (3) with time zone,
	CONSTRAINT "poker_sessions_buy_in_positive" CHECK ("poker_sessions"."buy_in" > 0)
);
--> statement-breakpoint
CREATE TABLE "poker_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign";--> statement-breakpoint
ALTER TABLE "poker_sessions" ADD CONSTRAINT "poker_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poker_hands_created_idx" ON "poker_hands" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "poker_hands_table_idx" ON "poker_hands" USING btree ("table_id","number" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "poker_sessions_one_open_uq" ON "poker_sessions" USING btree ("user_id") WHERE "poker_sessions"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "poker_sessions_user_idx" ON "poker_sessions" USING btree ("user_id","opened_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign" CHECK (("transactions"."type" = 'bet' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('payout', 'refund', 'daily_claim', 'signup_bonus', 'lab_reward', 'bonus_spin', 'referral', 'rain', 'lab_track', 'event_prize', 'event_refund', 'cashback', 'rescue') AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text IN ('event_entry', 'table_buyin') AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text = 'table_cashout' AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text IN ('guest_merge', 'admin_adjust', 'tip') AND "transactions"."amount" <> 0));