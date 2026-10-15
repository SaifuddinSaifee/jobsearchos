CREATE TABLE "resume_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"document_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"source" text DEFAULT 'record' NOT NULL,
	"record_version" integer,
	"base_version_id" uuid,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_review" boolean DEFAULT false NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bullet_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_generations" ADD CONSTRAINT "resume_generations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_generations" ADD CONSTRAINT "resume_generations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_generations" ADD CONSTRAINT "resume_generations_base_version_id_document_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_generations_status_idx" ON "resume_generations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "resume_generations_job_idx" ON "resume_generations" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_generations_one_open_idx" ON "resume_generations" USING btree ("job_id") WHERE "resume_generations"."status" in ('queued', 'matching', 'review', 'writing_queued', 'writing');--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_reason_check";--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_reason_check" CHECK ("reason" IN ('manual', 'export', 'attach', 'applied', 'upload', 'structured', 'restore', 'migrated', 'sent', 'generated'));
