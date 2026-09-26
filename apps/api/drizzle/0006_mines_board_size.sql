ALTER TABLE "mines_rounds" DROP CONSTRAINT "mines_rounds_mines_range";--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD COLUMN "size" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD CONSTRAINT "mines_rounds_size_range" CHECK ("mines_rounds"."size" BETWEEN 3 AND 8);--> statement-breakpoint
ALTER TABLE "mines_rounds" ADD CONSTRAINT "mines_rounds_mines_range" CHECK ("mines_rounds"."mines" BETWEEN 1 AND "mines_rounds"."size" * "mines_rounds"."size" - 1);