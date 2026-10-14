CREATE TABLE "career_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"base_version" integer,
	"proposal" jsonb,
	"decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_version_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"note" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "career_record_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"record" jsonb NOT NULL,
	"record_schema" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"change_note" text,
	"proposal_id" uuid,
	"restored_from_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_record_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "career_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid,
	"document_version_id" uuid,
	"profile_version_id" uuid,
	"text" text,
	"content_sha256" text NOT NULL,
	"label" text NOT NULL,
	"target_role" text,
	"company_id" uuid,
	"company_name" text,
	"written_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_sources_key_matches_kind" CHECK (("career_sources"."kind" in ('resume', 'cover_letter')) = ("career_sources"."document_version_id" is not null)
        and ("career_sources"."kind" = 'profile') = ("career_sources"."profile_version_id" is not null)
        and ("career_sources"."kind" = 'linkedin') = ("career_sources"."text" is not null))
);
--> statement-breakpoint
ALTER TABLE "career_proposals" ADD CONSTRAINT "career_proposals_source_id_career_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."career_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_sources" ADD CONSTRAINT "career_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_sources" ADD CONSTRAINT "career_sources_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_sources" ADD CONSTRAINT "career_sources_profile_version_id_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "career_sources" ADD CONSTRAINT "career_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_proposals_status_idx" ON "career_proposals" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "career_proposals_source_open_idx" ON "career_proposals" USING btree ("source_id") WHERE "career_proposals"."status" in ('queued', 'running', 'ready');--> statement-breakpoint
CREATE UNIQUE INDEX "career_proposals_one_open_idx" ON "career_proposals" USING btree ((1)) WHERE "career_proposals"."status" in ('running', 'ready');--> statement-breakpoint
CREATE UNIQUE INDEX "career_sources_version_idx" ON "career_sources" USING btree ("document_version_id") WHERE "career_sources"."document_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "career_sources_profile_idx" ON "career_sources" USING btree ("profile_version_id") WHERE "career_sources"."profile_version_id" is not null;--> statement-breakpoint
CREATE INDEX "career_sources_sha_idx" ON "career_sources" USING btree ("kind","content_sha256");--> statement-breakpoint
CREATE INDEX "career_sources_document_idx" ON "career_sources" USING btree ("document_id");--> statement-breakpoint
CREATE TRIGGER career_record_versions_no_update_delete
BEFORE UPDATE OR DELETE ON "career_record_versions"
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
