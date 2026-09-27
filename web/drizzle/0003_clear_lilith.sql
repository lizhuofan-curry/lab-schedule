CREATE TABLE "course_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "course_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"schedule_version_id" bigint NOT NULL,
	"name" text NOT NULL,
	"teacher" text,
	"location" text,
	"weekday" smallint NOT NULL,
	"start_period" smallint NOT NULL,
	"end_period" smallint NOT NULL,
	"weeks" smallint[] NOT NULL,
	"note" text,
	"color" text DEFAULT '#dce8e3' NOT NULL,
	CONSTRAINT "course_snapshots_name_not_blank" CHECK (length(trim("course_snapshots"."name")) > 0),
	CONSTRAINT "course_snapshots_weekday_valid" CHECK ("course_snapshots"."weekday" between 1 and 7),
	CONSTRAINT "course_snapshots_period_range_valid" CHECK ("course_snapshots"."start_period" >= 1 and "course_snapshots"."start_period" <= "course_snapshots"."end_period"),
	CONSTRAINT "course_snapshots_weeks_not_empty" CHECK (cardinality("course_snapshots"."weeks") > 0)
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"semester_id" bigint NOT NULL,
	"version_no" integer NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"course_count" integer NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_versions_version_positive" CHECK ("schedule_versions"."version_no" > 0),
	CONSTRAINT "schedule_versions_source_valid" CHECK ("schedule_versions"."source" in ('csv', 'xlsx')),
	CONSTRAINT "schedule_versions_course_count_valid" CHECK ("schedule_versions"."course_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "course_snapshots" ADD CONSTRAINT "course_snapshots_schedule_version_id_schedule_versions_id_fk" FOREIGN KEY ("schedule_version_id") REFERENCES "public"."schedule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_snapshots_schedule_version_id_idx" ON "course_snapshots" USING btree ("schedule_version_id");--> statement-breakpoint
CREATE INDEX "course_snapshots_schedule_version_weekday_idx" ON "course_snapshots" USING btree ("schedule_version_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_versions_student_semester_version_uidx" ON "schedule_versions" USING btree ("student_id","semester_id","version_no");--> statement-breakpoint
CREATE INDEX "schedule_versions_student_semester_created_idx" ON "schedule_versions" USING btree ("student_id","semester_id","created_at");--> statement-breakpoint
CREATE INDEX "schedule_versions_student_id_idx" ON "schedule_versions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "schedule_versions_semester_id_idx" ON "schedule_versions" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "schedule_versions_created_by_user_id_idx" ON "schedule_versions" USING btree ("created_by_user_id");