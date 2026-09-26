CREATE TYPE "public"."crash_phase" AS ENUM('betting', 'running', 'crashed');--> statement-breakpoint
CREATE TABLE "crash_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"auto_cashout_x100" integer,
	"cashout_x100" integer,
	"payout" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crash_bets_amount_positive" CHECK ("crash_bets"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "crash_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"phase" "crash_phase" DEFAULT 'betting' NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"crash_x100" integer NOT NULL,
	"opens_at" timestamp (3) with time zone NOT NULL,
	"starts_at" timestamp (3) with time zone NOT NULL,
	"crashes_at" timestamp (3) with time zone NOT NULL,
	"crashed_at" timestamp (3) with time zone,
	CONSTRAINT "crash_rounds_point_min" CHECK ("crash_rounds"."crash_x100" >= 100)
);
--> statement-breakpoint
ALTER TABLE "crash_bets" ADD CONSTRAINT "crash_bets_round_id_crash_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."crash_rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crash_bets" ADD CONSTRAINT "crash_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crash_bets_round_user_uq" ON "crash_bets" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "crash_bets_user_idx" ON "crash_bets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crash_rounds_number_uq" ON "crash_rounds" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "crash_rounds_one_live_uq" ON "crash_rounds" USING btree ((true)) WHERE "crash_rounds"."phase" <> 'crashed';