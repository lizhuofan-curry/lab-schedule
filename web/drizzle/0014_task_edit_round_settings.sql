ALTER TABLE "task_rounds" DROP CONSTRAINT "round_outcome_check";--> statement-breakpoint
ALTER TABLE "task_rounds" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "task_rounds" ADD COLUMN "delivery" text;--> statement-breakpoint
UPDATE "task_rounds" AS r SET "kind" = t."kind", "delivery" = t."delivery"
FROM "collab_tasks" AS t WHERE r."task_id" = t."id";--> statement-breakpoint
ALTER TABLE "task_rounds" ADD CONSTRAINT "round_kind_check" CHECK ("task_rounds"."kind" in ('announcement','assigned'));--> statement-breakpoint
ALTER TABLE "task_rounds" ADD CONSTRAINT "round_delivery_check" CHECK ("task_rounds"."delivery" in ('shared','individual'));--> statement-breakpoint
ALTER TABLE "task_rounds" ADD CONSTRAINT "round_outcome_check" CHECK ("task_rounds"."outcome" is null or "task_rounds"."outcome" in ('completed','cancelled','superseded'));
