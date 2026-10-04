CREATE TYPE "public"."application_status" AS ENUM('saved', 'preparing', 'applied', 'recruiter_screen', 'interview', 'technical_interview', 'final_interview', 'offer', 'rejected', 'withdrawn', 'ghosted');--> statement-breakpoint
CREATE TYPE "public"."fetch_method" AS ENUM('greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable', 'jsonld', 'html', 'playwright', 'paste');--> statement-breakpoint
CREATE TYPE "public"."job_origin" AS ENUM('manual', 'discovery');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('discovered', 'saved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."keyword_kind" AS ENUM('extracted', 'expanded');--> statement-breakpoint
CREATE TYPE "public"."remote_type" AS ENUM('remote', 'hybrid', 'onsite', 'unknown');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'saved' NOT NULL,
	"applied_at" timestamp with time zone,
	"application_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "job_keywords" (
	"job_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"kind" "keyword_kind" NOT NULL,
	CONSTRAINT "job_keywords_job_id_keyword_kind_pk" PRIMARY KEY("job_id","keyword","kind")
);
--> statement-breakpoint
CREATE TABLE "job_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_url" text,
	"fetch_method" "fetch_method" NOT NULL,
	"raw_file_id" uuid,
	"raw_text" text NOT NULL,
	"normalized" jsonb NOT NULL,
	"model" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text,
	"application_url" text,
	"ats" text,
	"ats_job_id" text,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"remote_type" "remote_type" DEFAULT 'unknown' NOT NULL,
	"employment_type" text,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"salary_period" text,
	"posted_at" date,
	"responsibilities" jsonb NOT NULL,
	"requirements" jsonb NOT NULL,
	"technologies" text[] NOT NULL,
	"origin" "job_origin" DEFAULT 'manual' NOT NULL,
	"status" "job_status" DEFAULT 'saved' NOT NULL,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_canonical_url_unique" UNIQUE("canonical_url"),
	CONSTRAINT "jobs_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_keywords" ADD CONSTRAINT "job_keywords_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_snapshots" ADD CONSTRAINT "job_snapshots_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_snapshots" ADD CONSTRAINT "job_snapshots_raw_file_id_files_id_fk" FOREIGN KEY ("raw_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_events" ADD CONSTRAINT "status_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "jobs" USING btree ("created_at");
--> statement-breakpoint
CREATE FUNCTION immutable_array_to_text(text[]) RETURNS text AS $$
  SELECT array_to_string($1, ' ')
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("company", '')), 'B') ||
  setweight(to_tsvector('english', immutable_array_to_text("technologies")), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX "jobs_search_idx" ON "jobs" USING gin ("search_vector");
--> statement-breakpoint
CREATE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER job_snapshots_no_update_delete
BEFORE UPDATE OR DELETE ON "job_snapshots"
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
