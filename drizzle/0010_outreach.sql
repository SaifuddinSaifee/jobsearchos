CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"email" text,
	"email_status" text DEFAULT 'none' NOT NULL,
	"confidence" integer,
	"source" text NOT NULL,
	"linkedin_url" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"rank" integer,
	"reason" text DEFAULT '' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outreach_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"contact_id" uuid,
	"to_email" text,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_job_idx" ON "contacts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_job_email_live_idx" ON "contacts" USING btree ("job_id",lower("email")) WHERE "contacts"."deleted_at" is null and "contacts"."email" is not null;--> statement-breakpoint
CREATE INDEX "outreach_emails_job_idx" ON "outreach_emails" USING btree ("job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_emails_one_draft_idx" ON "outreach_emails" USING btree ("job_id") WHERE "outreach_emails"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "outreach_emails_sent_idx" ON "outreach_emails" USING btree ("sent_at");