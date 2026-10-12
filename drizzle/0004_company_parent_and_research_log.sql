ALTER TABLE "companies" ADD COLUMN "research_log" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_parent_id_companies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;