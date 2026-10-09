CREATE TABLE "member_work_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_work_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_content_check" CHECK (char_length(trim("member_work_records"."title")) between 1 and 120 and char_length(trim("member_work_records"."description")) between 1 and 20000),
	CONSTRAINT "work_status_check" CHECK ("member_work_records"."status" in ('active','completed','paused') and (("member_work_records"."status" = 'completed') = ("member_work_records"."completed_at" is not null))),
	CONSTRAINT "work_revision_positive" CHECK ("member_work_records"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "member_work_records" ADD CONSTRAINT "member_work_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_student_updated_idx" ON "member_work_records" USING btree ("student_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_student_completed_idx" ON "member_work_records" USING btree ("student_id","completed_at");