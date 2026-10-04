CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"original_name" text,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "past_resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"role" text,
	"jd_text" text,
	"jd_url" text,
	"applied_at" timestamp with time zone,
	"extracted_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"preferences" jsonb NOT NULL,
	"generation_instructions" jsonb NOT NULL,
	"base_resume_file_id" uuid,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "past_resumes" ADD CONSTRAINT "past_resumes_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_versions" ADD CONSTRAINT "profile_versions_base_resume_file_id_files_id_fk" FOREIGN KEY ("base_resume_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "past_resumes_created_idx" ON "past_resumes" USING btree ("created_at");