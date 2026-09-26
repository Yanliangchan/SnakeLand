CREATE TYPE "public"."ladder_status" AS ENUM('playing', 'cashed_out', 'bust');--> statement-breakpoint
ALTER TYPE "public"."game_id" ADD VALUE 'carrier';--> statement-breakpoint
ALTER TYPE "public"."game_id" ADD VALUE 'tower';--> statement-breakpoint
ALTER TYPE "public"."game_id" ADD VALUE 'crossing';--> statement-breakpoint
CREATE TABLE "carrier_flights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bet" bigint NOT NULL,
	"mode" text NOT NULL,
	"landed" boolean NOT NULL,
	"final_x100" integer NOT NULL,
	"multiplier_x100" integer NOT NULL,
	"payout" bigint NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ladder_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"game" "game_id" NOT NULL,
	"mode" text NOT NULL,
	"status" "ladder_status" DEFAULT 'playing' NOT NULL,
	"bet" bigint NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"picks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"multiplier_x100" integer DEFAULT 100 NOT NULL,
	"payout" bigint,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ladder_rounds_game" CHECK ("ladder_rounds"."game"::text IN ('tower', 'crossing'))
);
--> statement-breakpoint
ALTER TABLE "carrier_flights" ADD CONSTRAINT "carrier_flights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ladder_rounds" ADD CONSTRAINT "ladder_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_flights_user_idx" ON "carrier_flights" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ladder_rounds_user_idx" ON "ladder_rounds" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ladder_rounds_one_active_uq" ON "ladder_rounds" USING btree ("user_id","game") WHERE "ladder_rounds"."status" = 'playing';