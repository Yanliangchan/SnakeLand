CREATE TABLE "baccarat_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"shoe_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"hand" jsonb NOT NULL,
	"bets" jsonb NOT NULL,
	"shoe_start" integer NOT NULL,
	"total_bet" bigint NOT NULL,
	"total_payout" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baccarat_shoes" (
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
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "baccarat_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "baccarat_rounds" ADD CONSTRAINT "baccarat_rounds_table_id_baccarat_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."baccarat_tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_rounds" ADD CONSTRAINT "baccarat_rounds_shoe_id_baccarat_shoes_id_fk" FOREIGN KEY ("shoe_id") REFERENCES "public"."baccarat_shoes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_rounds" ADD CONSTRAINT "baccarat_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_shoes" ADD CONSTRAINT "baccarat_shoes_table_id_baccarat_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."baccarat_tables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_shoes" ADD CONSTRAINT "baccarat_shoes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baccarat_tables" ADD CONSTRAINT "baccarat_tables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "baccarat_rounds_table_idx" ON "baccarat_rounds" USING btree ("table_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "baccarat_rounds_user_idx" ON "baccarat_rounds" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "baccarat_shoes_table_idx" ON "baccarat_shoes" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "baccarat_shoes_one_live_uq" ON "baccarat_shoes" USING btree ("table_id") WHERE "baccarat_shoes"."revealed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "baccarat_tables_one_open_uq" ON "baccarat_tables" USING btree ("user_id") WHERE "baccarat_tables"."closed_at" IS NULL;