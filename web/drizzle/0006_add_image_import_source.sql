ALTER TABLE "schedule_versions" DROP CONSTRAINT "schedule_versions_source_valid";--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_source_valid" CHECK ("schedule_versions"."source" in ('csv', 'xlsx', 'henu', 'text', 'image'));
