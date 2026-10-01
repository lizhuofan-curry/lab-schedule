CREATE TABLE "group_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "group_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"group_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_role_valid" CHECK ("group_members"."role" in ('leader', 'member'))
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_by_student_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_not_blank" CHECK (length(trim("groups"."name")) > 0),
	CONSTRAINT "groups_name_length_valid" CHECK (char_length("groups"."name") <= 40)
);
--> statement-breakpoint
ALTER TABLE "schedule_versions" DROP CONSTRAINT "schedule_versions_source_valid";--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_student_id_students_id_fk" FOREIGN KEY ("created_by_student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_group_student_uidx" ON "group_members" USING btree ("group_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_one_leader_uidx" ON "group_members" USING btree ("group_id") WHERE "group_members"."role" = 'leader';--> statement-breakpoint
CREATE INDEX "group_members_group_id_idx" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_members_student_id_idx" ON "group_members" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_uidx" ON "groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "groups_created_by_student_id_idx" ON "groups" USING btree ("created_by_student_id");--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_source_valid" CHECK ("schedule_versions"."source" in ('csv', 'xlsx', 'henu', 'text', 'image'));