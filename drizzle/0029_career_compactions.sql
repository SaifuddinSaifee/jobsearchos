CREATE TABLE "career_compactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"base_version" integer,
	"result" jsonb,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_version_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "compaction_id" uuid;--> statement-breakpoint
CREATE INDEX "career_compactions_status_idx" ON "career_compactions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "career_compactions_one_open_idx" ON "career_compactions" USING btree ((1)) WHERE "career_compactions"."status" in ('queued', 'running', 'ready');