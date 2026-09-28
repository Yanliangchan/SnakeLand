ALTER TYPE "public"."transaction_type" ADD VALUE 'cashback';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'rescue';--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_sign";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_sign" CHECK (("transactions"."type" = 'bet' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('payout', 'refund', 'daily_claim', 'signup_bonus', 'lab_reward', 'bonus_spin', 'referral', 'rain', 'lab_track', 'event_prize', 'event_refund', 'cashback', 'rescue') AND "transactions"."amount" > 0)
        OR ("transactions"."type"::text = 'event_entry' AND "transactions"."amount" < 0)
        OR ("transactions"."type"::text IN ('guest_merge', 'admin_adjust', 'tip') AND "transactions"."amount" <> 0));