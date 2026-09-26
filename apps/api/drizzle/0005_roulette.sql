CREATE TYPE "public"."roulette_phase" AS ENUM('betting', 'spinning', 'settled');--> statement-breakpoint
CREATE TABLE "roulette_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"bet_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"table_id" uuid NOT NULL,
	"payout" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roulette_bets_amount_positive" CHECK ("roulette_bets"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "roulette_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wheel_id" text NOT NULL,
	"number" integer NOT NULL,
	"phase" "roulette_phase" DEFAULT 'betting' NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"result" integer,
	"opens_at" timestamp (3) with time zone NOT NULL,
	"closes_at" timestamp (3) with time zone NOT NULL,
	"spin_ends_at" timestamp (3) with time zone,
	"settled_at" timestamp (3) with time zone,
	CONSTRAINT "roulette_rounds_result_range" CHECK ("roulette_rounds"."result" IS NULL OR "roulette_rounds"."result" BETWEEN 0 AND 36)
);
--> statement-breakpoint
ALTER TABLE "roulette_bets" ADD CONSTRAINT "roulette_bets_round_id_roulette_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."roulette_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roulette_bets" ADD CONSTRAINT "roulette_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roulette_bets_round_idx" ON "roulette_bets" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "roulette_bets_user_idx" ON "roulette_bets" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "roulette_rounds_wheel_number_uq" ON "roulette_rounds" USING btree ("wheel_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "roulette_rounds_one_live_uq" ON "roulette_rounds" USING btree ("wheel_id") WHERE "roulette_rounds"."phase" <> 'settled';