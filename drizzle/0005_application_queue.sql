CREATE TYPE "public"."queue_status" AS ENUM('queued', 'running', 'saved', 'needs_review', 'duplicate', 'failed');--> statement-breakpoint
CREATE TABLE "application_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"input" text NOT NULL,
	"source_url" text,
	"label" text NOT NULL,
	"status" "queue_status" DEFAULT 'queued' NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft" jsonb,
	"error" text,
	"error_code" text,
	"job_id" uuid,
	"duplicate_job_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_queue" ADD CONSTRAINT "application_queue_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_queue" ADD CONSTRAINT "application_queue_duplicate_job_id_jobs_id_fk" FOREIGN KEY ("duplicate_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_queue_status_idx" ON "application_queue" USING btree ("status","created_at");