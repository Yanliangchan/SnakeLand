CREATE TYPE "public"."event_mode" AS ENUM('race', 'ffa');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'live', 'ended', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'event_entry';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'event_prize';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'event_refund';--> statement-breakpoint
CREATE TABLE "event_crash_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"round" integer NOT NULL,
	"bet" bigint NOT NULL,
	"target_x100" integer NOT NULL,
	"crash_x100" integer NOT NULL,
	"payout" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_entries" (
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"stack" bigint NOT NULL,
	"rounds_played" integer DEFAULT 0 NOT NULL,
	"wagered" bigint DEFAULT 0 NOT NULL,
	"rank" integer,
	"payout" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_entries_stack_non_negative" CHECK ("event_entries"."stack" >= 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"mode" "event_mode" NOT NULL,
	"game" text,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"stack" bigint NOT NULL,
	"buy_in" bigint DEFAULT 0 NOT NULL,
	"top_up" bigint DEFAULT 0 NOT NULL,
	"rounds" integer,
	"config" jsonb,
	"seed" text NOT NULL,
	"seed_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "events_window" CHECK ("events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_amounts" CHECK ("events"."stack" > 0 AND "events"."buy_in" >= 0 AND "events"."top_up" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign";--> statement-breakpoint
DROP INDEX "baccarat_tables_one_open_uq";--> statement-breakpoint
DROP INDEX "blackjack_tables_one_open_uq";--> statement-breakpoint
DROP INDEX "ladder_rounds_one_active_uq";--> statement-breakpoint
DROP INDEX "mines_rounds_one_active_uq";--> statement-breakpoint
ALTER TABLE "baccarat_tables" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "blackjack_tables" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "carrier_flights" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "ladder_rounds" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "plinko_drops" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "event_crash_rounds" ADD CONSTRAINT "event_crash_rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_crash_rounds" ADD CONSTRAINT "event_crash_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_entries" ADD CONSTRAINT "event_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_entries" ADD CONSTRAINT "event_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_crash_rounds_uq" ON "event_crash_rounds" USING btree ("event_id","user_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "event_entries_pk" ON "event_entries" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "event_entries_user_idx" ON "event_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_window_idx" ON "events" USING btree ("status","ends_at");--> statement-breakpoint
ALTER TABLE "baccarat_tables" ADD CONSTRAINT "baccarat_tables_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackjack_tables" ADD CONSTRAINT "blackjack_tables_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_flights" ADD CONSTRAINT "carrier_flights_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ladder_rounds" ADD CONSTRAINT "ladder_rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD CONSTRAINT "mines_rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plinko_drops" ADD CONSTRAINT "plinko_drops_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "baccarat_tables_one_open_uq" ON "baccarat_tables" USING btree ("user_id",coalesce("event_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "baccarat_tables"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "blackjack_tables_one_open_uq" ON "blackjack_tables" USING btree ("user_id",coalesce("event_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "blackjack_tables"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ladder_rounds_one_active_uq" ON "ladder_rounds" USING btree ("user_id","game",coalesce("event_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "ladder_rounds"."status" = 'playing';--> statement-breakpoint
CREATE UNIQUE INDEX "mines_rounds_one_active_uq" ON "mines_rounds" USING btree ("user_id",coalesce("event_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "mines_rounds"."status" = 'playing';--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign" CHECK (("transactions"."type" = 'bet' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('payout', 'refund', 'daily_claim', 'signup_bonus', 'lab_reward', 'bonus_spin', 'referral', 'rain', 'lab_track', 'event_prize', 'event_refund') AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text = 'event_entry' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('guest_merge', 'admin_adjust', 'tip') AND "transactions"."amount" <> 0));