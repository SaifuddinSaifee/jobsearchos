CREATE TABLE "resume_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"section" text NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_indexes" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"parsed" jsonb,
	"note" text,
	"error" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD COLUMN "attachment_file_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD COLUMN "attachment_name" text;--> statement-breakpoint
ALTER TABLE "past_resumes" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "resume_chunks" ADD CONSTRAINT "resume_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_indexes" ADD CONSTRAINT "resume_indexes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_chunks_file_ordinal_idx" ON "resume_chunks" USING btree ("file_id","ordinal");--> statement-breakpoint
CREATE INDEX "resume_chunks_embedding_idx" ON "resume_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "resume_indexes_status_idx" ON "resume_indexes" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_attachment_file_id_files_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "past_resumes" ADD CONSTRAINT "past_resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;