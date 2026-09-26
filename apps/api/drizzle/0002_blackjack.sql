CREATE TYPE "public"."round_status" AS ENUM('in_progress', 'settled');--> statement-breakpoint
CREATE TABLE "blackjack_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"shoe_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" "round_status" DEFAULT 'in_progress' NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"shoe_start" integer NOT NULL,
	"total_bet" bigint NOT NULL,
	"total_payout" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blackjack_shoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"decks" integer NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text,
	"position" integer DEFAULT 0 NOT NULL,
	"cut_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone,
	CONSTRAINT "blackjack_shoes_position_range" CHECK ("blackjack_shoes"."position" >= 0 AND "blackjack_shoes"."position" <= "blackjack_shoes"."decks" * 52)
);
--> statement-breakpoint
CREATE TABLE "blackjack_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_table_id_blackjack_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."blackjack_tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_shoe_id_blackjack_shoes_id_fk" FOREIGN KEY ("shoe_id") REFERENCES "public"."blackjack_shoes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_rounds" ADD CONSTRAINT "blackjack_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_shoes" ADD CONSTRAINT "blackjack_shoes_table_id_blackjack_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."blackjack_tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_shoes" ADD CONSTRAINT "blackjack_shoes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_tables" ADD CONSTRAINT "blackjack_tables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blackjack_rounds_table_idx" ON "blackjack_rounds" USING btree ("table_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "blackjack_rounds_user_idx" ON "blackjack_rounds" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "blackjack_rounds_one_active_uq" ON "blackjack_rounds" USING btree ("table_id") WHERE "blackjack_rounds"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "blackjack_shoes_table_idx" ON "blackjack_shoes" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blackjack_shoes_one_live_uq" ON "blackjack_shoes" USING btree ("table_id") WHERE "blackjack_shoes"."revealed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blackjack_tables_one_open_uq" ON "blackjack_tables" USING btree ("user_id") WHERE "blackjack_tables"."closed_at" IS NULL;