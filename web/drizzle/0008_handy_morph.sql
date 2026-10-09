CREATE TABLE "collab_tasks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collab_tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"publisher_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"delivery" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_round" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_kind_check" CHECK ("collab_tasks"."kind" in ('announcement','assigned')),
	CONSTRAINT "tasks_delivery_check" CHECK ("collab_tasks"."delivery" in ('shared','individual')),
	CONSTRAINT "tasks_status_check" CHECK ("collab_tasks"."status" in ('active','completed','cancelled')),
	CONSTRAINT "tasks_round_revision_positive" CHECK ("collab_tasks"."current_round" > 0 and "collab_tasks"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" bigint NOT NULL,
	"round_id" bigint NOT NULL,
	"actor_id" bigint,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_files" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" bigint NOT NULL,
	"task_id" bigint,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_size_check" CHECK ("task_files"."size" > 0 and "task_files"."size" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "task_notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recipient_id" bigint NOT NULL,
	"task_id" bigint NOT NULL,
	"round_id" bigint NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"assignment" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_participants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"round_id" bigint NOT NULL,
	"student_id" bigint NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "participant_generation_positive" CHECK ("task_participants"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "task_rounds" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_rounds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"task_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"deadline" timestamp with time zone,
	"capacity" integer,
	"claims_open" boolean DEFAULT false NOT NULL,
	"direct_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "round_values_check" CHECK ("task_rounds"."number" > 0 and ("task_rounds"."capacity" is null or "task_rounds"."capacity" > 0) and length(trim("task_rounds"."title")) > 0 and length(trim("task_rounds"."description")) > 0),
	CONSTRAINT "round_outcome_check" CHECK ("task_rounds"."outcome" is null or "task_rounds"."outcome" in ('completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"round_id" bigint NOT NULL,
	"subject_key" text NOT NULL,
	"version" integer NOT NULL,
	"request_key" text NOT NULL,
	"author_id" bigint NOT NULL,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"feedback" text,
	"reviewer_id" bigint,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_version_positive" CHECK ("task_submissions"."version" > 0),
	CONSTRAINT "submission_status_check" CHECK ("task_submissions"."status" in ('pending','returned','approved'))
);
--> statement-breakpoint
ALTER TABLE "collab_tasks" ADD CONSTRAINT "collab_tasks_publisher_id_students_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_collab_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collab_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_round_id_task_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."task_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_id_students_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_creator_id_students_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_task_id_collab_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collab_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notifications" ADD CONSTRAINT "task_notifications_recipient_id_students_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notifications" ADD CONSTRAINT "task_notifications_task_id_collab_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collab_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notifications" ADD CONSTRAINT "task_notifications_round_id_task_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."task_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_participants" ADD CONSTRAINT "task_participants_round_id_task_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."task_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_participants" ADD CONSTRAINT "task_participants_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_rounds" ADD CONSTRAINT "task_rounds_task_id_collab_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."collab_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_round_id_task_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."task_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_author_id_students_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_reviewer_id_students_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_publisher_idx" ON "collab_tasks" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "tasks_status_updated_idx" ON "collab_tasks" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "event_task_created_idx" ON "task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "event_round_idx" ON "task_events" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "event_actor_idx" ON "task_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "file_creator_idx" ON "task_files" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "file_task_idx" ON "task_files" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "task_notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "task_notifications" USING btree ("recipient_id") WHERE "task_notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_task_idx" ON "task_notifications" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "notification_round_idx" ON "task_notifications" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_round_student_uidx" ON "task_participants" USING btree ("round_id","student_id");--> statement-breakpoint
CREATE INDEX "participant_student_idx" ON "task_participants" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_task_number_uidx" ON "task_rounds" USING btree ("task_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_round_subject_version_uidx" ON "task_submissions" USING btree ("round_id","subject_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_request_uidx" ON "task_submissions" USING btree ("round_id","author_id","request_key");--> statement-breakpoint
CREATE INDEX "submission_author_idx" ON "task_submissions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "submission_reviewer_idx" ON "task_submissions" USING btree ("reviewer_id");