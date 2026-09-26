CREATE TYPE "public"."mines_status" AS ENUM('playing', 'cashed_out', 'bust');--> statement-breakpoint
CREATE TYPE "public"."plinko_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "fair_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"next_server_seed" text NOT NULL,
	"next_server_seed_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mines_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" "mines_status" DEFAULT 'playing' NOT NULL,
	"bet" bigint NOT NULL,
	"mines" integer NOT NULL,
	"picks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bust_tile" integer,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"multiplier_x100" integer DEFAULT 100 NOT NULL,
	"payout" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "mines_rounds_mines_range" CHECK ("mines_rounds"."mines" BETWEEN 1 AND 24)
);
--> statement-breakpoint
CREATE TABLE "plinko_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"bet" bigint NOT NULL,
	"rows" integer NOT NULL,
	"risk" "plinko_risk" NOT NULL,
	"path" jsonb NOT NULL,
	"bucket" integer NOT NULL,
	"multiplier_x100" integer NOT NULL,
	"payout" bigint NOT NULL,
	"server_seed" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plinko_drops_rows_range" CHECK ("plinko_drops"."rows" BETWEEN 8 AND 16)
);
--> statement-breakpoint
ALTER TABLE "fair_seeds" ADD CONSTRAINT "fair_seeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD CONSTRAINT "mines_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plinko_drops" ADD CONSTRAINT "plinko_drops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mines_rounds_user_idx" ON "mines_rounds" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mines_rounds_one_active_uq" ON "mines_rounds" USING btree ("user_id") WHERE "mines_rounds"."status" = 'playing';--> statement-breakpoint
CREATE INDEX "plinko_drops_user_idx" ON "plinko_drops" USING btree ("user_id","created_at" DESC NULLS LAST);