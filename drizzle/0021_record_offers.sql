ALTER TABLE "resume_chunks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "resume_chunks" CASCADE;--> statement-breakpoint
ALTER TABLE "career_proposals" ADD COLUMN "auto_apply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "record_choice" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "record_choice_version_id" uuid;--> statement-breakpoint
ALTER TABLE "resume_indexes" DROP COLUMN "chunk_count";--> statement-breakpoint
ALTER TABLE "resume_indexes" DROP COLUMN "embedding_model";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_record_choice" CHECK ("documents"."record_choice" is null or "documents"."record_choice" in ('later', 'never'));