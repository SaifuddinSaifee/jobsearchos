ALTER TABLE "llm_calls" ADD COLUMN "retry_count" integer;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "retry_wait_ms" integer;--> statement-breakpoint
ALTER TABLE "resume_generations" ADD COLUMN "work_ms" integer;