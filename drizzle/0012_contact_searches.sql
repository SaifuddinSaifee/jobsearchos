CREATE TABLE "contact_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"found" integer,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_searches" ADD CONSTRAINT "contact_searches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_searches_status_idx" ON "contact_searches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contact_searches_job_idx" ON "contact_searches" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_searches_one_active_idx" ON "contact_searches" USING btree ("job_id") WHERE "contact_searches"."status" in ('queued', 'running');