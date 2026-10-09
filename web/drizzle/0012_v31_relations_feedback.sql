CREATE TABLE "graph_relation_feedback" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "graph_relation_feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"student_id" bigint NOT NULL,
	"edge_id" text NOT NULL,
	"input_version" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_feedback_version" CHECK ("graph_relation_feedback"."input_version" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "graph_feedback_reason" CHECK (length(trim("graph_relation_feedback"."reason")) between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "graph_analysis_state" ADD COLUMN "relations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "graph_relation_feedback" ADD CONSTRAINT "graph_relation_feedback_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_feedback_member_edge_version_uidx" ON "graph_relation_feedback" USING btree ("student_id","edge_id","input_version");--> statement-breakpoint
CREATE INDEX "graph_feedback_created_idx" ON "graph_relation_feedback" USING btree ("created_at");