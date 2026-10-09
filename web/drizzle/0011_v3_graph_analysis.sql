CREATE TABLE "graph_analysis_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"input_version" text NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analyzed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	"calls" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "graph_state_singleton" CHECK ("graph_analysis_state"."id" = 1),
	CONSTRAINT "graph_state_values" CHECK ("graph_analysis_state"."status" in ('pending','running','ready','failed') and "graph_analysis_state"."attempts" >= 0 and "graph_analysis_state"."calls" >= 0 and "graph_analysis_state"."input_tokens" >= 0 and "graph_analysis_state"."output_tokens" >= 0),
	CONSTRAINT "graph_state_version" CHECK ("graph_analysis_state"."input_version" ~ '^[0-9a-f]{64}$')
);
