CREATE TABLE "document_drafts" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"base_version_id" uuid,
	"content_sha256" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"content_schema" integer DEFAULT 1 NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"markdown" text NOT NULL,
	"plain_text" text NOT NULL,
	"content_sha256" text NOT NULL,
	"page_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"restored_from_version_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"origin" text NOT NULL,
	"title" text NOT NULL,
	"job_id" uuid,
	"company_id" uuid,
	"company_name" text,
	"target_role" text,
	"written_on" date,
	"jd_text" text,
	"jd_url" text,
	"is_base" boolean DEFAULT false NOT NULL,
	"source_name" text,
	"source_mime" text,
	"source_sha256" text,
	"source_file_id" uuid,
	"page_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"legacy_past_resume_id" uuid,
	"outreach_email_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_legacy_past_resume_id_unique" UNIQUE("legacy_past_resume_id"),
	CONSTRAINT "documents_outreach_email_id_unique" UNIQUE("outreach_email_id"),
	CONSTRAINT "documents_base_is_resume" CHECK (not "documents"."is_base" or "documents"."kind" = 'resume')
);
--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD COLUMN "attachment_document_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD COLUMN "attachment_version_id" uuid;--> statement-breakpoint
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_locked_job_id_jobs_id_fk" FOREIGN KEY ("locked_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_legacy_past_resume_id_past_resumes_id_fk" FOREIGN KEY ("legacy_past_resume_id") REFERENCES "public"."past_resumes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_outreach_email_id_outreach_emails_id_fk" FOREIGN KEY ("outreach_email_id") REFERENCES "public"."outreach_emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_one_base_idx" ON "documents" USING btree ("is_base") WHERE "documents"."is_base" and "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_kind_idx" ON "documents" USING btree ("kind","updated_at");--> statement-breakpoint
CREATE INDEX "documents_job_idx" ON "documents" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "documents_source_sha_idx" ON "documents" USING btree ("source_sha256");--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_attachment_document_id_documents_id_fk" FOREIGN KEY ("attachment_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_attachment_version_id_document_versions_id_fk" FOREIGN KEY ("attachment_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_check" CHECK ("kind" IN ('resume', 'cover_letter', 'email'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_origin_check" CHECK ("origin" IN ('uploaded', 'pasted', 'blank', 'copied', 'sent', 'generated'));--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_reason_check" CHECK ("reason" IN ('manual', 'export', 'attach', 'applied', 'upload', 'structured', 'restore', 'migrated', 'sent'));--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("plain_text", ''))) STORED;--> statement-breakpoint
CREATE INDEX "document_versions_search_idx" ON "document_versions" USING gin ("search_vector");--> statement-breakpoint
-- Versions never change. The one allowed update is locking a version once (when its job is marked Applied or the
-- email it was attached to is sent), and a lock is never undone. Generated columns are not computed yet inside a
-- BEFORE trigger, so search_vector is left out of the comparison.
CREATE FUNCTION document_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.locked_at IS NULL
     AND NEW.locked_at IS NOT NULL
     AND (to_jsonb(NEW) - 'locked_at' - 'locked_job_id' - 'search_vector')
       = (to_jsonb(OLD) - 'locked_at' - 'locked_job_id' - 'search_vector') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'document_versions rows are immutable (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_versions_guard
BEFORE UPDATE OR DELETE ON "document_versions"
FOR EACH ROW EXECUTE FUNCTION document_versions_guard();
