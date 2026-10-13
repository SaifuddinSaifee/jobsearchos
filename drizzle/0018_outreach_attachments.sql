CREATE TABLE "outreach_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"document_id" uuid,
	"file_id" uuid,
	"version_id" uuid,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_attachments_has_source" CHECK ("outreach_attachments"."document_id" is not null or "outreach_attachments"."file_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP CONSTRAINT "outreach_emails_attachment_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP CONSTRAINT "outreach_emails_attachment_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP CONSTRAINT "outreach_emails_attachment_version_id_document_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "outreach_attachments" ADD CONSTRAINT "outreach_attachments_email_id_outreach_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."outreach_emails"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attachments" ADD CONSTRAINT "outreach_attachments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attachments" ADD CONSTRAINT "outreach_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attachments" ADD CONSTRAINT "outreach_attachments_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_attachments_email_idx" ON "outreach_attachments" USING btree ("email_id","position");--> statement-breakpoint
CREATE INDEX "outreach_attachments_file_idx" ON "outreach_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_attachments_email_document_idx" ON "outreach_attachments" USING btree ("email_id","document_id") WHERE "outreach_attachments"."document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_attachments_email_file_idx" ON "outreach_attachments" USING btree ("email_id","file_id") WHERE "outreach_attachments"."document_id" is null;--> statement-breakpoint
-- Every draft and sent email keeps the one attachment it had, as its first (and only) attachment.
INSERT INTO "outreach_attachments" ("email_id", "position", "document_id", "file_id", "version_id", "name", "created_at")
SELECT "id", 0, "attachment_document_id", "attachment_file_id", "attachment_version_id", "attachment_name", coalesce("sent_at", "updated_at")
  FROM "outreach_emails"
 WHERE "attachment_document_id" IS NOT NULL OR "attachment_file_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP COLUMN "attachment_file_id";--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP COLUMN "attachment_name";--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP COLUMN "attachment_document_id";--> statement-breakpoint
ALTER TABLE "outreach_emails" DROP COLUMN "attachment_version_id";