ALTER TABLE "companies" DROP CONSTRAINT "companies_normalized_name_unique";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_canonical_url_unique";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_dedup_key_unique";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_normalized_name_live_idx" ON "companies" USING btree ("normalized_name") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_canonical_url_live_idx" ON "jobs" USING btree ("canonical_url") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_key_live_idx" ON "jobs" USING btree ("dedup_key") WHERE deleted_at is null;