ALTER TYPE "public"."transaction_type" ADD VALUE 'bonus_spin';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'referral';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'tip';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'rain';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'lab_track';--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"href" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign";--> statement-breakpoint
ALTER TABLE "lab_challenges" ADD COLUMN "track" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "last_spin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "spin_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "announcements_active_idx" ON "announcements" USING btree ("active","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign" CHECK (("transactions"."type" = 'bet' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('payout', 'refund', 'daily_claim', 'signup_bonus', 'lab_reward', 'bonus_spin', 'referral', 'rain', 'lab_track') AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text IN ('guest_merge', 'admin_adjust', 'tip') AND "transactions"."amount" <> 0));