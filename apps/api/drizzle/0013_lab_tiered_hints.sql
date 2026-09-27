CREATE TABLE "lab_hint_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"challenge_id" uuid NOT NULL,
	"hint_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_challenges" ADD COLUMN "hints" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_hint_unlocks" ADD CONSTRAINT "lab_hint_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_hint_unlocks" ADD CONSTRAINT "lab_hint_unlocks_challenge_id_lab_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."lab_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_hint_unlocks_uq" ON "lab_hint_unlocks" USING btree ("user_id","challenge_id","hint_index");