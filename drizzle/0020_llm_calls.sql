CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"step" text NOT NULL,
	"run_id" uuid,
	"model" text NOT NULL,
	"reasoning_effort" text,
	"status" text NOT NULL,
	"error" text,
	"finish_reason" text,
	"prompt_tokens" integer,
	"cached_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cost_usd" double precision,
	"duration_ms" integer NOT NULL,
	"trace_id" text,
	"job_id" uuid,
	"company_id" uuid,
	"document_id" uuid,
	"document_version_id" uuid,
	"proposal_id" uuid,
	"search_id" uuid,
	"queue_item_id" uuid
);
--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_job_idx" ON "llm_calls" USING btree ("job_id","created_at") WHERE "llm_calls"."job_id" is not null;