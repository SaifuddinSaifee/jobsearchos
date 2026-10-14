-- The search index moves from stored files to library document versions. Rows made for files are kept as they were
-- (frozen, no longer searched or worked on); new rows are keyed by document version.
DROP INDEX "resume_chunks_file_ordinal_idx";--> statement-breakpoint
ALTER TABLE "resume_chunks" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_indexes" DROP CONSTRAINT "resume_indexes_pkey";--> statement-breakpoint
ALTER TABLE "resume_indexes" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_chunks" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "resume_indexes" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_indexes" ADD CONSTRAINT "resume_indexes_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "resume_indexes" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "resume_chunks" ADD CONSTRAINT "resume_chunks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_indexes" ADD CONSTRAINT "resume_indexes_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_chunks_version_ordinal_idx" ON "resume_chunks" USING btree ("document_version_id","ordinal") WHERE "resume_chunks"."document_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_indexes_file_idx" ON "resume_indexes" USING btree ("file_id") WHERE "resume_indexes"."file_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_indexes_version_idx" ON "resume_indexes" USING btree ("document_version_id") WHERE "resume_indexes"."document_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_chunks_file_ordinal_idx" ON "resume_chunks" USING btree ("file_id","ordinal") WHERE "resume_chunks"."file_id" is not null;--> statement-breakpoint
ALTER TABLE "resume_chunks" ADD CONSTRAINT "resume_chunks_one_key" CHECK (num_nonnulls("resume_chunks"."file_id", "resume_chunks"."document_version_id") = 1);--> statement-breakpoint
ALTER TABLE "resume_indexes" ADD CONSTRAINT "resume_indexes_one_key" CHECK (num_nonnulls("resume_indexes"."file_id", "resume_indexes"."document_version_id") = 1);--> statement-breakpoint
-- A file that was still waiting would never be worked on now; say so instead of leaving it queued forever.
UPDATE "resume_indexes" SET "status" = 'failed', "error" = 'Replaced by the library index.', "finished_at" = now() WHERE "file_id" IS NOT NULL AND "status" IN ('queued', 'running');
