ALTER TYPE "public"."game_id" ADD VALUE 'penalty';--> statement-breakpoint
ALTER TYPE "public"."game_id" ADD VALUE 'hilo';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'lab_reward';--> statement-breakpoint
CREATE TABLE "lab_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"description" text NOT NULL,
	"flag_mode" text DEFAULT 'static' NOT NULL,
	"flag_hash" text,
	"reward" bigint NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hint" text,
	"published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_challenges_slug_unique" UNIQUE("slug"),
	CONSTRAINT "lab_challenges_reward_positive" CHECK ("lab_challenges"."reward" > 0),
	CONSTRAINT "lab_challenges_flag" CHECK ("lab_challenges"."flag_mode" = 'per_player' OR "lab_challenges"."flag_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "lab_solves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"reward" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"daily" boolean DEFAULT true NOT NULL,
	"titles" boolean DEFAULT true NOT NULL,
	"daily_notified_for" timestamp with time zone,
	"last_title" text,
	"title_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "ladder_rounds" DROP CONSTRAINT "ladder_rounds_game";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "chat_muted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lab_solves" ADD CONSTRAINT "lab_solves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_solves" ADD CONSTRAINT "lab_solves_challenge_id_lab_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."lab_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_solves_user_challenge_uq" ON "lab_solves" USING btree ("user_id","challenge_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ladder_rounds" ADD CONSTRAINT "ladder_rounds_game" CHECK ("ladder_rounds"."game"::text IN ('tower', 'crossing', 'penalty', 'hilo'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign" CHECK (("transactions"."type" = 'bet' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('payout', 'refund', 'daily_claim', 'signup_bonus', 'lab_reward') AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text IN ('guest_merge', 'admin_adjust') AND "transactions"."amount" <> 0));